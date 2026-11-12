import AppIntents
import AVFoundation
import Foundation
import Photos
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
    func perform() async throws -> some IntentResult & ReturnsValue<[IntentFile]> & ProvidesDialog {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }

        let staging = Task.detached(priority: .userInitiated) { [photos] in
            try photos.enumerated().map { index, file in
                try Task.checkCancellation()
                let folder = temporary.appendingPathComponent(String(index), isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let destination = folder.appendingPathComponent(Self.filename(for: file))
                if let source = file.fileURL {
                    try PhotoProcessing.copyImported(source, to: destination)
                } else {
                    try file.data.write(to: destination)
                }
                return destination
            }
        }
        let staged = try await withTaskCancellationHandler { try await staging.value } onCancel: { staging.cancel() }
        try Task.checkCancellation()
        let settings = PhotoProcessingOptions.current
        let options = PhotoProcessingOptions(gpu: gpu ?? settings.gpu, portrait: portrait ?? settings.portrait,
                                             detail: detail ?? settings.detail, style: style ?? settings.style,
                                             model: model ?? settings.model)
        let result = try await PhotoProcessing.shared.runShortcut(files: staged, options: options)
        guard !result.files.isEmpty else { throw ShortcutFailure(message: result.failures.first ?? "No photo was saved.") }

        let files = result.files.map { IntentFile(data: $0.data, filename: $0.name, type: .heic) }
        let dialog: IntentDialog
        if !result.failures.isEmpty {
            dialog = "Saved \(files.count) to Photos. \(result.failures.count) didn’t complete. Open the results tray in Stylio for details."
        } else if let reason = result.depthWarnings.first {
            dialog = "Saved \(files.count) to Photos. Lighting Depth wasn’t added to \(result.depthWarnings.count): \(reason)"
        } else if result.lostMotionCount > 0 {
            dialog = "Saved \(files.count) to Photos. \(result.lostMotionCount) Live Photos were saved as stills."
        } else if result.liveCount == files.count {
            dialog = files.count == 1 ? "Live Photo saved to Photos." : "Saved \(files.count) Live Photos to Photos."
        } else {
            dialog = files.count == 1 ? "Photo saved to Photos." : "Saved \(files.count) photos to Photos."
        }
        return .result(value: files, dialog: dialog)
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
enum ShortcutLivePhotoLookup {
    static func copyMotion(for info: NativeEngine.LivePhotoInfo, filename: String, to destination: URL) async throws -> PHAsset? {
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
                if try await copyIfMatching(asset, identifier: info.identifier, to: destination) { return asset }
            }
        }

        // A filename narrows the lookup if the capture date or timezone is missing or edited.
        // The MOV still has to match the original content identifier before it can be used.
        let stem = (filename as NSString).deletingPathExtension
        guard !stem.isEmpty, stem != "Photo" else { return nil }
        let matches = try await namedCandidates(stem: stem, excluding: checked)
        for asset in matches {
            if try await copyIfMatching(asset, identifier: info.identifier, to: destination) { return asset }
        }
        return nil
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

    private static func copyIfMatching(_ asset: PHAsset, identifier: String, to destination: URL) async throws -> Bool {
        try Task.checkCancellation()
        guard let movie = PHAssetResource.assetResources(for: asset).first(where: { $0.type == .pairedVideo }) else { return false }
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
