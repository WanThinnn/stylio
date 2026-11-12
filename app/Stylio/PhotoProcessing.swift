import Combine
import CoreLocation
import Foundation
import ImageIO
import Photos
import UIKit

enum PhotoAIModel: String, CaseIterable, Sendable {
    case lite, standard, pro
}

struct PhotoProcessingOptions {
    var gpu = true
    var portrait = false
    var detail = false
    var style = false
    var model = PhotoAIModel.standard

    static var current: Self {
        let preferences = UserDefaults.standard
        return Self(
            gpu: preferences.object(forKey: "stylio.ai.gpu") as? Bool ?? true,
            portrait: preferences.bool(forKey: "stylio.ai.portrait"),
            detail: preferences.bool(forKey: "stylio.ai.detail"),
            style: preferences.bool(forKey: "stylio.ai.style"),
            model: PhotoAIModel(rawValue: preferences.string(forKey: "stylio.ai.model") ?? "") ?? .standard
        )
    }

    var arguments: [String: Any] {
        ["gpu": gpu, "portrait": portrait, "detail": detail, "style": style, "model": model.rawValue]
    }
}

@MainActor
final class PhotoProcessing: ObservableObject {
    static let shared = PhotoProcessing()

    enum Input {
        case photo(PHAsset)
        case file(URL, movie: URL?)

        var name: String {
            switch self {
            case .photo(let asset):
                PhotoLibrary.originalPhoto(in: PHAssetResource.assetResources(for: asset))?.originalFilename ?? "Photo"
            case .file(let url, _): url.lastPathComponent
            }
        }
    }

    struct Job: Identifiable {
        let id = UUID()
        let name: String
        var message = "Waiting"
        var progress: Double?
        var result: Output?
        var notes: [String] = []
        var failed = false
        var saving = false
        var saveError: String?
    }

    struct Output {
        let photo: URL
        let movie: URL?
        let date: Date?
        let location: CLLocation?
        let lostMotion: Bool
        let depthWarning: String?
        let usedSharedJPEG: Bool
    }

    struct BatchResult {
        var files: [(name: String, data: Data)] = []
        var savedCount = 0
        var liveCount = 0
        var lostMotionCount = 0
        var depthWarningCount = 0
        var sharedJPEGCount = 0
        var failures: [String] = []
    }

    private enum ProcessingError: LocalizedError {
        case photoUnavailable, photosAccess, unsupportedMovie, emptySelection, busy

        var errorDescription: String? {
            switch self {
            case .photoUnavailable: "The original photo could not be read from Photos."
            case .photosAccess: "Allow Stylio to add photos in the iOS Settings app."
            case .unsupportedMovie: "Select the still image alongside its Live Photo MOV."
            case .emptySelection: "Select a photo to process."
            case .busy: "Stylio is busy. Try again in a moment."
            }
        }
    }

    @Published private(set) var jobs: [Job] = []
    @Published private(set) var isProcessing = false
    @Published private(set) var isMaintaining = false
    @Published private(set) var resetCount = 0
    var isBusy: Bool { isProcessing || isMaintaining || jobs.contains(where: \.saving) }
    var hasResultIssues: Bool { jobs.contains { $0.failed || $0.saveError != nil || ($0.result == nil && !$0.notes.isEmpty) } }

    private let engine = NativeEngine()
    private let workDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("StylioProcessing", isDirectory: true)

    private init() { try? FileManager.default.removeItem(at: workDirectory) }

    func start(assets: [PHAsset], files: [URL]) throws {
        let inputs = try beginBatch(assets: assets, files: files)
        let options = PhotoProcessingOptions.current
        Task {
            defer { isProcessing = false }
            let result = await run(inputs, options: options, fromShortcut: false)
            if UIApplication.shared.applicationState == .background {
                await ProcessingNotifications.post(result)
            }
        }
    }

    func runShortcut(files: [URL], options: PhotoProcessingOptions) async throws -> BatchResult {
        let inputs = try beginBatch(assets: [], files: files)
        defer { isProcessing = false }
        let result = await run(inputs, options: options, fromShortcut: true)
        try Task.checkCancellation()
        return result
    }

    private func beginBatch(assets: [PHAsset], files: [URL]) throws -> [Input] {
        guard !isBusy else { throw ProcessingError.busy }
        let (movies, photos) = files.reduce(into: ([URL](), [URL]())) { groups, file in
            if file.pathExtension.lowercased() == "mov" { groups.0.append(file) }
            else { groups.1.append(file) }
        }
        var unpairedMovies = Set(movies)
        let imported: [Input] = photos.map { photo in
            let stem = photo.deletingPathExtension().lastPathComponent.lowercased()
            let matching = movies.filter { unpairedMovies.contains($0) && $0.deletingPathExtension().lastPathComponent.lowercased() == stem }
            let movie = matching.count == 1 ? matching.first : photos.count == 1 && movies.count == 1 ? movies.first : nil
            if let movie { unpairedMovies.remove(movie) }
            return .file(photo, movie: movie)
        }
        guard unpairedMovies.isEmpty else { throw ProcessingError.unsupportedMovie }
        let inputs = assets.map(Input.photo) + imported
        guard !inputs.isEmpty else { throw ProcessingError.emptySelection }

        for job in jobs where job.saveError == nil {
            try? FileManager.default.removeItem(at: workFolder(for: job.id))
        }
        jobs = inputs.map { Job(name: $0.name) } + jobs.filter { $0.saveError != nil }
        isProcessing = true
        return inputs
    }

    private func run(_ inputs: [Input], options: PhotoProcessingOptions, fromShortcut: Bool) async -> BatchResult {
        let keepAwake = !fromShortcut && UserDefaults.standard.bool(forKey: "stylio.keepScreenAwake")
        let idleTimerWasDisabled = keepAwake && UIApplication.shared.isIdleTimerDisabled
        if keepAwake { UIApplication.shared.isIdleTimerDisabled = true }
        defer { if keepAwake { UIApplication.shared.isIdleTimerDisabled = idleTimerWasDisabled } }

        var result = BatchResult()
        let ids = jobs.prefix(inputs.count).map(\.id)
        for (id, input) in zip(ids, inputs) {
            guard let index = jobs.firstIndex(where: { $0.id == id }) else { continue }
            await process(input, at: index, options: options.arguments, recoverLivePhoto: fromShortcut)
            let name = jobs[index].name
            let saved = await saveResult(at: index, returnPhoto: fromShortcut)
            guard let (output, data) = saved else {
                result.failures.append("\(name): \(jobs[index].saveError ?? jobs[index].message)")
                continue
            }
            result.savedCount += 1
            if output.movie != nil { result.liveCount += 1 }
            if output.lostMotion { result.lostMotionCount += 1 }
            if output.depthWarning != nil { result.depthWarningCount += 1 }
            if output.usedSharedJPEG { result.sharedJPEGCount += 1 }
            guard fromShortcut else { continue }
            guard let data else {
                result.failures.append("\(name) was saved to Photos but couldn’t be returned to Shortcuts.")
                continue
            }
            result.files.append((output.photo.lastPathComponent, data))
        }
        return result
    }

    func retrySaving(_ id: UUID) async {
        guard !isBusy, let index = jobs.firstIndex(where: { $0.id == id && $0.saveError != nil }) else { return }
        _ = await saveResult(at: index, returnPhoto: false)
    }

    private func saveResult(at index: Int, returnPhoto: Bool) async -> (output: Output, data: Data?)? {
        guard let output = jobs[index].result else { return nil }
        jobs[index].saving = true
        jobs[index].saveError = nil
        jobs[index].message = output.movie == nil ? "Saving to Photos…" : "Saving Live Photo…"
        do {
            var authorization = PHPhotoLibrary.authorizationStatus(for: .addOnly)
            if authorization == .notDetermined { authorization = await PHPhotoLibrary.requestAuthorization(for: .addOnly) }
            guard authorization == .authorized || authorization == .limited else { throw ProcessingError.photosAccess }
            try await PHPhotoLibrary.shared().performChanges {
                let creation = PHAssetCreationRequest.forAsset()
                if let date = output.date { creation.creationDate = date }
                if let location = output.location { creation.location = location }
                creation.addResource(with: .photo, fileURL: output.photo, options: nil)
                if let movie = output.movie { creation.addResource(with: .pairedVideo, fileURL: movie, options: nil) }
            }
        } catch {
            jobs[index].message = "Couldn’t save to Photos"
            jobs[index].saveError = error.localizedDescription
            jobs[index].saving = false
            return nil
        }

        // Photos has committed both resources. Only Shortcuts needs a copy to return.
        let data = returnPhoto ? (try? Data(contentsOf: output.photo, options: .mappedIfSafe)) : nil
        try? FileManager.default.removeItem(at: workFolder(for: jobs[index].id))
        if output.lostMotion || output.depthWarning != nil {
            if let warning = output.depthWarning, !jobs[index].notes.contains(warning) { jobs[index].notes.append(warning) }
            jobs[index].result = nil
            jobs[index].message = output.movie == nil ? "Saved to Photos" : "Live Photo saved to Photos"
            jobs[index].saving = false
        } else {
            jobs.remove(at: index)
        }
        return (output, data)
    }

    func maintain(_ action: NativeEngine.CacheAction) async throws {
        guard !isBusy else { return }
        isMaintaining = true
        defer { isMaintaining = false }
        try await engine.maintain(action)
        if action == .reset {
            if FileManager.default.fileExists(atPath: workDirectory.path) {
                try FileManager.default.removeItem(at: workDirectory)
            }
            jobs = []
            let preferences = UserDefaults.standard
            for key in preferences.dictionaryRepresentation().keys where key.hasPrefix("stylio.") {
                preferences.removeObject(forKey: key)
            }
            resetCount += 1
        }
    }

    private func process(_ input: Input, at index: Int, options: [String: Any], recoverLivePhoto: Bool) async {
        let folder = workFolder(for: jobs[index].id)
        var usedSharedJPEG = false
        do {
            try Task.checkCancellation()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            jobs[index].message = "Reading the original photo…"
            var files = try await stage(input, in: folder)
            var asset: PHAsset? = if case .photo(let asset) = input { asset } else { nil }
            var wasLivePhoto = files.movie != nil || asset?.mediaSubtypes.contains(.photoLive) == true
            var captureDate: Date?
            let sharedLocation = recoverLivePhoto ? Self.captureLocation(in: files.input) : nil
            var sourceName = input.name
            if recoverLivePhoto, let info = try await engine.inspectSharedPhoto(files.input) {
                usedSharedJPEG = info.isJPEG
                wasLivePhoto = wasLivePhoto || info.identifier != nil
                captureDate = info.captureDate
                if info.isJPEG || (info.identifier != nil && files.movie == nil) {
                    jobs[index].message = info.isJPEG ? "Finding the original photo…" : "Finding the original Live Photo motion…"
                    if let recovered = try await recoverSharedPhoto(files, info: info, name: sourceName, in: folder) {
                        files = recovered.files
                        asset = recovered.asset
                        sourceName = recovered.name
                        wasLivePhoto = wasLivePhoto || recovered.asset.mediaSubtypes.contains(.photoLive)
                        usedSharedJPEG = false
                    }
                }
            }
            try Task.checkCancellation()
            let result = try await engine.process(files, name: sourceName, options: options) { [weak self] message, progress in
                if let message { self?.jobs[index].message = message }
                if let progress { self?.jobs[index].progress = min(max(progress, 0), 100) }
            }
            var notes = result.notes
            var movie: URL?
            switch result.movie {
            case .none:
                if wasLivePhoto {
                    notes.append("The paired video could not be found. This result is a still photo.")
                }
            case .compatible: movie = files.movie
            case .repaired: movie = files.movieOutput
            case .needsTracks: notes.append("The original motion lacks the metadata this edit needs. This result is a still photo.")
            case .mismatch: notes.append("The image and video pairing IDs could not be verified. This result is a still photo.")
            }
            if let originalMovie = files.movie, originalMovie != movie { try? FileManager.default.removeItem(at: originalMovie) }
            try? FileManager.default.removeItem(at: files.input)
            let photo = folder.appendingPathComponent(URL(fileURLWithPath: result.name).lastPathComponent)
            if photo != files.output { try FileManager.default.moveItem(at: files.output, to: photo) }
            try Task.checkCancellation()
            jobs[index].notes = notes
            jobs[index].result = Output(photo: photo, movie: movie, date: asset?.creationDate ?? captureDate,
                                        location: asset?.location ?? sharedLocation, lostMotion: wasLivePhoto && movie == nil,
                                        depthWarning: result.depthWarning, usedSharedJPEG: usedSharedJPEG)
            jobs[index].progress = nil
        } catch {
            try? FileManager.default.removeItem(at: folder)
            jobs[index].failed = true
            var message = error.localizedDescription
            if usedSharedJPEG && !Task.isCancelled {
                let access = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                let explanation: String = switch access {
                case .authorized: String(localized: "Stylio could not verify a matching HEIC in Photos.")
                case .limited: String(localized: "Stylio could not verify a matching HEIC in the photos it can access.")
                default: String(localized: "Stylio needs access to Photos to look up the matching HEIC.")
                }
                message += "\n" + explanation
            }
            jobs[index].message = message
            jobs[index].progress = nil
        }
    }

    private func recoverSharedPhoto(_ files: ProcessingFiles, info: NativeEngine.SharedPhotoInfo, name: String, in folder: URL) async throws
        -> (files: ProcessingFiles, asset: PHAsset, name: String)? {
        let motion = folder.appendingPathComponent("recovered.mov")
        let motionAsset: PHAsset? = if info.identifier != nil {
            try await ShortcutPhotoLookup.copyMotion(for: info, filename: name, to: motion)
        } else { nil }
        if !info.isJPEG {
            guard let motionAsset else { return nil }
            return (ProcessingFiles(input: files.input, movie: motion, movieOutput: files.movieOutput, output: files.output), motionAsset, name)
        }

        func verify(_ candidate: PHAsset) async throws -> (still: URL, asset: PHAsset, resource: PHAssetResource)? {
            let resources = PHAssetResource.assetResources(for: candidate)
            guard let photo = ShortcutPhotoLookup.currentHEIC(in: resources),
                  let still = try await recoverOriginalStill(photo, matching: files.input, identifier: info.identifier, in: folder) else { return nil }
            return (still, candidate, photo)
        }

        var checked = Set<String>()
        var verified: (still: URL, asset: PHAsset, resource: PHAssetResource)?
        if let motionAsset {
            checked.insert(motionAsset.localIdentifier)
            verified = try await verify(motionAsset)
        }
        if verified == nil,
           let candidate = try await ShortcutPhotoLookup.originalAsset(matching: files.input, filename: name, captureDate: info.captureDate),
           checked.insert(candidate.localIdentifier).inserted {
            verified = try await verify(candidate)
        }
        if verified == nil,
           let candidate = try await ShortcutPhotoLookup.assetNamed(name, matching: files.input, excluding: checked) {
            verified = try await verify(candidate)
        }
        let verifiedMotion = verified?.resource.type == .photo && verified?.asset.localIdentifier == motionAsset?.localIdentifier
        if !verifiedMotion { try? FileManager.default.removeItem(at: motion) }
        guard let (original, asset, resource) = verified else { return nil }
        var pairedMovie = verifiedMotion ? motion : files.movie
        if !verifiedMotion, asset.mediaSubtypes.contains(.photoLive),
           let identifier = try await engine.inspectSharedPhoto(original)?.identifier,
           try await ShortcutPhotoLookup.copyIfMatching(asset, identifier: identifier, to: motion, edited: resource.type == .fullSizePhoto) {
            pairedMovie = motion
        }
        try? FileManager.default.removeItem(at: files.input)
        if let movie = files.movie, movie != pairedMovie { try? FileManager.default.removeItem(at: movie) }
        return (ProcessingFiles(input: original, movie: pairedMovie, movieOutput: files.movieOutput, output: files.output), asset, resource.originalFilename)
    }

    private static func captureLocation(in file: URL) -> CLLocation? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, CGImageSourceGetPrimaryImageIndex(source), nil) as? [String: Any],
              let gps = properties[kCGImagePropertyGPSDictionary as String] as? [String: Any],
              let latitude = (gps[kCGImagePropertyGPSLatitude as String] as? NSNumber)?.doubleValue,
              let longitude = (gps[kCGImagePropertyGPSLongitude as String] as? NSNumber)?.doubleValue else { return nil }
        let south = (gps[kCGImagePropertyGPSLatitudeRef as String] as? String)?.uppercased() == "S"
        let west = (gps[kCGImagePropertyGPSLongitudeRef as String] as? String)?.uppercased() == "W"
        let coordinate = CLLocationCoordinate2D(latitude: south ? -abs(latitude) : latitude,
                                                longitude: west ? -abs(longitude) : longitude)
        guard CLLocationCoordinate2DIsValid(coordinate) else { return nil }
        return CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }

    private func recoverOriginalStill(_ photo: PHAssetResource, matching jpeg: URL, identifier: String?, in folder: URL) async throws -> URL? {
        let still = folder.appendingPathComponent("recovered.heic")
        do {
            try await Self.write(photo, to: still)
            if let identifier, photo.type == .photo {
                if let info = try await engine.inspectSharedPhoto(still), !info.isJPEG, info.identifier == identifier { return still }
            } else if await ShortcutPhotoLookup.matchesJPEG(jpeg, original: still) {
                return still
            }
        } catch {
            // Process the shared JPEG if its original resource is unavailable.
        }
        try? FileManager.default.removeItem(at: still)
        try Task.checkCancellation()
        return nil
    }

    private func workFolder(for id: UUID) -> URL {
        workDirectory.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    private func stage(_ input: Input, in folder: URL) async throws -> ProcessingFiles {
        let movieDestination = folder.appendingPathComponent("original.mov")
        let movieOutput = folder.appendingPathComponent("processed.mov")
        let output = folder.appendingPathComponent("processed.heic")
        switch input {
        case .photo(let asset):
            let resources = PHAssetResource.assetResources(for: asset)
            guard let photo = PhotoLibrary.originalPhoto(in: resources) else { throw ProcessingError.photoUnavailable }
            let still = folder.appendingPathComponent("input").appendingPathExtension(URL(fileURLWithPath: photo.originalFilename).pathExtension)
            try await Self.write(photo, to: still)
            let movie = asset.mediaSubtypes.contains(.photoLive) ? resources.first { $0.type == .pairedVideo } : nil
            if let movie { try await Self.write(movie, to: movieDestination) }
            return ProcessingFiles(input: still, movie: movie == nil ? nil : movieDestination, movieOutput: movieOutput, output: output)
        case .file(let file, let movie):
            let still = folder.appendingPathComponent("input").appendingPathExtension(file.pathExtension)
            try await Task.detached(priority: .userInitiated) {
                try Self.copyImported(file, to: still)
                if let movie { try Self.copyImported(movie, to: movieDestination) }
            }.value
            return ProcessingFiles(input: still, movie: movie == nil ? nil : movieDestination, movieOutput: movieOutput, output: output)
        }
    }

    static func write(_ resource: PHAssetResource, to destination: URL) async throws {
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        try await PHAssetResourceManager.default().writeData(for: resource, toFile: destination, options: options)
    }

    nonisolated static func copyImported(_ source: URL, to destination: URL) throws {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        try FileManager.default.copyItem(at: source, to: destination)
    }
}
