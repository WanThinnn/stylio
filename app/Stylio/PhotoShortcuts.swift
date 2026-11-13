import AppIntents
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import Photos
import UIKit
import UniformTypeIdentifiers

extension PhotoAIModel: AppEnum {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "AI Model"
    static let caseDisplayRepresentations: [PhotoAIModel: DisplayRepresentation] = [
        .lite: "Lite", .standard: "Standard", .pro: "Pro",
    ]
}

struct ProcessPhotosIntent: AppIntent {
    static let title: LocalizedStringResource = "Process Photos with Stylio"
    static let description = IntentDescription(
        "Processes the input and saves new photos to your library. Original Live Photo motion is preserved when the matching pair is compatible.",
        categoryName: "Photos"
    )

    static let openAppWhenRun = false
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .background }

    @Parameter(title: "Photos", supportedTypeIdentifiers: ["public.image", "com.apple.quicktime-movie"])
    var photos: [IntentFile]

    @Parameter(title: "GPU Acceleration", description: "Uses the Stylio setting when left unset.")
    var gpu: Bool?

    @Parameter(title: "Lighting Depth Effect", description: "Uses the Stylio setting when left unset.")
    var portrait: Bool?

    @Parameter(title: "Sharpen Photo", description: "Uses the Stylio setting when left unset.")
    var detail: Bool?

    @Parameter(title: "Adaptive Styles", description: "Uses the Stylio setting when left unset.")
    var style: Bool?

    @Parameter(title: "AI Model", description: "Uses the Stylio setting when left unset.")
    var model: PhotoAIModel?

    static var parameterSummary: some ParameterSummary {
        Summary("Process \(\.$photos) with Stylio") {
            \.$gpu
            \.$portrait
            \.$detail
            \.$style
            \.$model
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[IntentFile]> {
        try Task.checkCancellation()
        let settings = PhotoProcessingOptions.current
        let options = PhotoProcessingOptions(gpu: gpu ?? settings.gpu, portrait: portrait ?? settings.portrait,
                                             detail: detail ?? settings.detail, style: style ?? settings.style,
                                             model: model ?? settings.model)
        let result = try await PhotoProcessing.shared.runShortcut(files: photos.map { ($0, Self.filename(for: $0)) }, options: options)
        guard result.savedCount > 0 else { throw ShortcutFailure(message: result.failures.first ?? "No photo was saved.") }

        let files = result.files.map {
            var file = IntentFile(fileURL: $0.url, filename: $0.name, type: .heic)
            file.removedOnCompletion = true
            return file
        }
        await ProcessingNotifications.post(result)
        return .result(value: files)
    }

    private static func filename(for file: IntentFile) -> String {
        let name = (file.filename as NSString).lastPathComponent
        let fallback = file.type?.conforms(to: .movie) == true ? "Motion" : "Photo"
        let safeName = name.isEmpty || name == "." || name == ".." ? fallback : name
        let ext = (safeName as NSString).pathExtension
        if file.type?.conforms(to: .quickTimeMovie) == true {
            return (safeName as NSString).deletingPathExtension + ".mov"
        }
        if let type = file.type, type.conforms(to: .heic) || type.conforms(to: .heif) {
            return (safeName as NSString).deletingPathExtension + "." + (type.preferredFilenameExtension ?? "heic")
        }
        if file.type?.conforms(to: .jpeg) == true {
            return (safeName as NSString).deletingPathExtension + ".jpg"
        }
        if ext.isEmpty, let inferred = file.type?.preferredFilenameExtension ?? file.fileURL?.pathExtension, !inferred.isEmpty {
            return safeName + "." + inferred
        }
        return safeName
    }

    private struct ShortcutFailure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }
}

struct StylioShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ProcessPhotosIntent(),
            phrases: ["Process photos with \(.applicationName)"],
            shortTitle: "Process Photos",
            systemImageName: "camera.filters"
        )
    }
}

@MainActor
enum ShortcutPhotoLookup {
    static func copyMotion(for info: NativeEngine.SharedPhotoInfo, filename: String, to destination: URL) async throws -> PHAsset? {
        guard let identifier = info.identifier else { return nil }
        let status = await PhotoLibrary.authorizeReading()
        guard status == .authorized || status == .limited else { return nil }

        var checked = Set<String>()
        if let date = info.captureDate {
            let options = livePhotoOptions()
            options.predicate = NSPredicate(
                format: "(mediaSubtypes & %d) != 0 AND creationDate >= %@ AND creationDate <= %@",
                Int(PHAssetMediaSubtype.photoLive.rawValue),
                date.addingTimeInterval(-2) as NSDate, date.addingTimeInterval(2) as NSDate
            )
            let candidates = PHAsset.fetchAssets(with: .image, options: options)
            for index in 0..<candidates.count {
                let asset = candidates.object(at: index)
                checked.insert(asset.localIdentifier)
                if try await copyIfMatching(asset, identifier: identifier, to: destination) { return asset }
            }
        }

        // A filename narrows the lookup if the capture date or timezone is missing or edited.
        // The MOV still has to match the original content identifier before it can be used.
        let stem = (filename as NSString).deletingPathExtension
        guard !stem.isEmpty, stem != "Photo" else { return nil }
        let matches = try await namedCandidates(stem: stem, excluding: checked)
        for asset in matches {
            if try await copyIfMatching(asset, identifier: identifier, to: destination) { return asset }
        }
        return nil
    }

    static func originalAsset(matching jpeg: URL, filename: String, captureDate: Date?) async throws -> PHAsset? {
        let status = await PhotoLibrary.authorizeReading()
        guard status == .authorized || status == .limited else { return nil }
        let stem = (filename as NSString).deletingPathExtension
        let lookup = Task.detached(priority: .utility) {
            guard let shared = Self.thumbnailPixels(jpeg) else { return nil as PHAsset? }
            let deadline = ContinuousClock.now + .seconds(4)
            if let captureDate {
                let options = PhotoLibrary.photoOptions(sorted: false)
                options.includeAllBurstAssets = true
                options.predicate = NSPredicate(format: "creationDate >= %@ AND creationDate <= %@",
                                                captureDate.addingTimeInterval(-2) as NSDate, captureDate.addingTimeInterval(2) as NSDate)
                let candidates = PHAsset.fetchAssets(with: .image, options: options)
                if candidates.count <= 100 {
                    // A real filename and matching time can identify an iCloud-only photo
                    // even when Photos has no local thumbnail. Verify the HEIC after fetching it.
                    if !["", "photo", "image", "jpeg"].contains(stem.lowercased()) {
                        let named = (0..<candidates.count).compactMap { index -> PHAsset? in
                            let asset = candidates.object(at: index)
                            guard Self.matchesFilename(stem, for: asset) else { return nil }
                            return asset
                        }
                        if named.count == 1 { return named.first }
                    }
                    if let match = try Self.uniqueVisualMatch(shared, in: candidates, strict: false, before: deadline) { return match }
                }
            }

            // The Share Sheet can remove both the name and EXIF. Check only
            // recent local previews before requesting a full-size resource.
            let recent = PhotoLibrary.photoOptions()
            recent.includeAllBurstAssets = true
            recent.fetchLimit = 100
            let candidates = PHAsset.fetchAssets(with: .image, options: recent)
            return try Self.uniqueVisualMatch(shared, in: candidates, strict: true, before: deadline)
        }
        return try await withTaskCancellationHandler { try await lookup.value } onCancel: { lookup.cancel() }
    }

    static func assetNamed(_ filename: String, matching jpeg: URL, excluding checked: Set<String>) async throws -> PHAsset? {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        let stem = (filename as NSString).deletingPathExtension
        guard status == .authorized || status == .limited,
              !["", "photo", "image", "jpeg"].contains(stem.lowercased()) else { return nil }
        let lookup = Task.detached(priority: .utility) {
            let options = PhotoLibrary.photoOptions(sorted: false)
            options.includeAllBurstAssets = true
            let assets = PHAsset.fetchAssets(with: .image, options: options)
            let deadline = ContinuousClock.now + .seconds(4)
            var candidates: [PHAsset] = []
            for index in 0..<assets.count {
                try Task.checkCancellation()
                guard ContinuousClock.now < deadline else { return nil as PHAsset? }
                let asset = assets.object(at: index)
                if Self.matchesFilename(stem, for: asset) { candidates.append(asset) }
            }
            guard let first = candidates.first else { return nil }
            if candidates.count == 1 { return checked.contains(first.localIdentifier) ? nil : first }
            guard let shared = Self.thumbnailPixels(jpeg) else { return nil }
            let match = try Self.uniqueVisualMatch(shared, in: candidates, strict: true, before: deadline)
            guard let match, !checked.contains(match.localIdentifier) else { return nil }
            return match
        }
        return try await withTaskCancellationHandler { try await lookup.value } onCancel: { lookup.cancel() }
    }

    static func matchesJPEG(_ jpeg: URL, original: URL) async -> Bool {
        await Task.detached(priority: .utility) {
            guard let shared = Self.thumbnailPixels(jpeg), let reference = Self.thumbnailPixels(original) else { return false }
            return shared.matches(reference, strict: false)
        }.value
    }

    nonisolated static func currentHEIC(in resources: [PHAssetResource]) -> PHAssetResource? {
        let edited = resources.first { $0.type == .fullSizePhoto }
        let resource = edited ?? (resources.contains { $0.type == .adjustmentData } ? nil : PhotoLibrary.originalPhoto(in: resources))
        guard let resource else { return nil }
        let type: UTType? = if #available(iOS 26.0, *) {
            resource.contentType
        } else {
            UTType(resource.uniformTypeIdentifier)
        }
        return type?.conforms(to: .heic) == true || type?.conforms(to: .heif) == true ? resource : nil
    }

    private nonisolated static func matchesFilename(_ stem: String, for asset: PHAsset) -> Bool {
        let resources = PHAssetResource.assetResources(for: asset)
        guard let current = currentHEIC(in: resources) else { return false }
        let names = [PhotoLibrary.originalPhoto(in: resources)?.originalFilename, current.originalFilename].compactMap { $0 }
        return names.contains { ($0 as NSString).deletingPathExtension.caseInsensitiveCompare(stem) == .orderedSame }
    }

    private nonisolated static func uniqueVisualMatch(_ shared: ThumbnailPixels, in candidates: PHFetchResult<PHAsset>,
                                                      strict: Bool, before deadline: ContinuousClock.Instant) throws -> PHAsset? {
        let assets = (0..<candidates.count).map { candidates.object(at: $0) }
        return try uniqueVisualMatch(shared, in: assets, strict: strict, before: deadline)
    }

    private nonisolated static func uniqueVisualMatch(_ shared: ThumbnailPixels, in candidates: [PHAsset],
                                                      strict: Bool, before deadline: ContinuousClock.Instant) throws -> PHAsset? {
        let options = PHImageRequestOptions()
        options.isSynchronous = true
        options.isNetworkAccessAllowed = false
        options.resizeMode = .exact
        let size = CGSize(width: 128, height: 128)
        var match: PHAsset?
        for asset in candidates {
            try Task.checkCancellation()
            guard ContinuousClock.now < deadline else { return nil }
            guard Self.currentHEIC(in: PHAssetResource.assetResources(for: asset)) != nil else { continue }
            var sample: ThumbnailPixels?
            PHImageManager.default().requestImage(for: asset, targetSize: size, contentMode: .aspectFit, options: options) { image, _ in
                if let image { sample = Self.thumbnailPixels(image) }
            }
            guard let sample, shared.matches(sample, strict: strict) else { continue }
            if match != nil { return nil }
            match = asset
        }
        return match
    }

    private struct ThumbnailPixels {
        let aspectRatio: CGFloat
        let bytes: [UInt8]

        func matches(_ reference: Self, strict: Bool) -> Bool {
            guard abs(aspectRatio / reference.aspectRatio - 1) <= 0.025 else { return false }
            var total = 0
            var outliers = 0
            var lowestGreen = UInt8.max
            var highestGreen = UInt8.min
            for offset in stride(from: 0, to: bytes.count, by: 4) {
                let red = abs(Int(bytes[offset]) - Int(reference.bytes[offset]))
                let green = abs(Int(bytes[offset + 1]) - Int(reference.bytes[offset + 1]))
                let blue = abs(Int(bytes[offset + 2]) - Int(reference.bytes[offset + 2]))
                total += red + green + blue
                if max(red, green, blue) > 20 { outliers += 1 }
                lowestGreen = min(lowestGreen, bytes[offset + 1])
                highestGreen = max(highestGreen, bytes[offset + 1])
            }
            let count = bytes.count / 4
            if strict && Int(highestGreen) - Int(lowestGreen) < 32 { return false }
            return total <= count * 3 * (strict ? 3 : 6) && outliers * (strict ? 50 : 20) <= count
        }
    }

    private nonisolated static func thumbnailPixels(_ url: URL) -> ThumbnailPixels? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, CGImageSourceGetPrimaryImageIndex(source), [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 128,
              ] as CFDictionary) else { return nil }
        return thumbnailPixels(image, aspectRatio: CGFloat(image.width) / CGFloat(image.height))
    }

    private nonisolated static func thumbnailPixels(_ image: UIImage) -> ThumbnailPixels? {
        guard image.size.width > 0, image.size.height > 0 else { return nil }
        let aspectRatio = image.size.width / image.size.height
        if image.imageOrientation == .up, let cgImage = image.cgImage {
            return thumbnailPixels(cgImage, aspectRatio: aspectRatio)
        }
        let size = CGSize(width: 64, height: 64)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.preferredRange = .standard
        let oriented = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let cgImage = oriented.cgImage else { return nil }
        return thumbnailPixels(cgImage, aspectRatio: aspectRatio)
    }

    private nonisolated static func thumbnailPixels(_ image: CGImage, aspectRatio: CGFloat) -> ThumbnailPixels? {
        guard let color = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let edge = 64
        var pixels = [UInt8](repeating: 0, count: edge * edge * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: edge, height: edge,
                                          bitsPerComponent: 8, bytesPerRow: edge * 4, space: color,
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: edge, height: edge))
            return true
        }
        return drawn ? ThumbnailPixels(aspectRatio: aspectRatio, bytes: pixels) : nil
    }

    private nonisolated static func livePhotoOptions() -> PHFetchOptions {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "(mediaSubtypes & %d) != 0", Int(PHAssetMediaSubtype.photoLive.rawValue))
        return options
    }

    private static func namedCandidates(stem: String, excluding checked: Set<String>) async throws -> [PHAsset] {
        let lookup = Task.detached(priority: .utility) {
            let candidates = PHAsset.fetchAssets(with: .image, options: Self.livePhotoOptions())
            var matches: [PHAsset] = []
            for index in 0..<candidates.count {
                try Task.checkCancellation()
                let asset = candidates.object(at: index)
                guard !checked.contains(asset.localIdentifier),
                      let original = PhotoLibrary.originalPhoto(in: PHAssetResource.assetResources(for: asset)) else { continue }
                let originalStem = (original.originalFilename as NSString).deletingPathExtension
                if originalStem.caseInsensitiveCompare(stem) == .orderedSame { matches.append(asset) }
            }
            return matches
        }
        return try await withTaskCancellationHandler { try await lookup.value } onCancel: { lookup.cancel() }
    }

    static func copyIfMatching(_ asset: PHAsset, identifier: String, to destination: URL, edited: Bool = false) async throws -> Bool {
        try Task.checkCancellation()
        let resources = PHAssetResource.assetResources(for: asset)
        let editedMovie = edited ? resources.first { $0.type == .fullSizePairedVideo } : nil
        guard let movie = editedMovie ?? resources.first(where: { $0.type == .pairedVideo }) else { return false }
        do {
            try await PhotoProcessing.write(movie, to: destination)
            let metadata = try await AVURLAsset(url: destination).loadMetadata(for: .quickTimeMetadata)
            if let item = metadata.first(where: { $0.identifier == .quickTimeMetadataContentIdentifier }) {
                let candidateIdentifier = try await item.load(.stringValue)
                try Task.checkCancellation()
                if candidateIdentifier == identifier { return true }
            }
        } catch {
            // An unavailable iCloud resource or unreadable MOV can be skipped.
        }
        try? FileManager.default.removeItem(at: destination)
        try Task.checkCancellation()
        return false
    }
}
