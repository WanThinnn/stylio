import Combine
import CoreLocation
import Foundation
import Photos
import UIKit

enum PhotoAIModel: String, CaseIterable {
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
        var failed = false
        var saving = false
        var saveError: String?
    }

    struct Output {
        let photo: URL
        let movie: URL?
        let notes: [String]
        let date: Date?
        let location: CLLocation?
        let lostMotion: Bool
        let depthWarning: String?
    }

    struct ShortcutResult {
        var files: [(name: String, data: Data)] = []
        var liveCount = 0
        var lostMotionCount = 0
        var depthWarnings: [String] = []
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
    var hasResultErrors: Bool { jobs.contains { $0.failed || $0.saveError != nil } }

    private let engine = NativeEngine()
    private let workDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("StylioProcessing", isDirectory: true)

    private init() { try? FileManager.default.removeItem(at: workDirectory) }

    func start(assets: [PHAsset], files: [URL]) throws {
        let inputs = try beginBatch(assets: assets, files: files)
        let options = PhotoProcessingOptions.current
        Task {
            defer { isProcessing = false }
            await run(inputs, options: options, recoverLivePhotos: false)
        }
    }

    func runShortcut(files: [URL], options: PhotoProcessingOptions) async throws -> ShortcutResult {
        let inputs = try beginBatch(assets: [], files: files)
        defer { isProcessing = false }
        await run(inputs, options: options, recoverLivePhotos: true)
        try Task.checkCancellation()

        var result = ShortcutResult()
        for job in jobs.prefix(inputs.count) {
            guard let output = job.result, job.saveError == nil, !job.failed else {
                result.failures.append("\(job.name): \(job.saveError ?? job.message)")
                continue
            }
            do {
                let data = try Data(contentsOf: output.photo, options: .mappedIfSafe)
                result.files.append((output.photo.lastPathComponent, data))
                if output.movie != nil { result.liveCount += 1 }
                if output.lostMotion { result.lostMotionCount += 1 }
                if let warning = output.depthWarning { result.depthWarnings.append(warning) }
            } catch {
                result.failures.append("\(job.name) was saved to Photos but couldn’t be returned to Shortcuts.")
            }
        }
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

    private func run(_ inputs: [Input], options: PhotoProcessingOptions, recoverLivePhotos: Bool) async {
        let idleTimerWasDisabled = UIApplication.shared.isIdleTimerDisabled
        let keepAwake = !recoverLivePhotos && UserDefaults.standard.bool(forKey: "stylio.keepScreenAwake")
        if keepAwake { UIApplication.shared.isIdleTimerDisabled = true }
        defer { if keepAwake { UIApplication.shared.isIdleTimerDisabled = idleTimerWasDisabled } }
        for (index, input) in inputs.enumerated() {
            await process(input, at: index, options: options.arguments, recoverLivePhoto: recoverLivePhotos)
        }
    }

    func retrySaving(_ id: UUID) async {
        guard !isBusy, let index = jobs.firstIndex(where: { $0.id == id && $0.saveError != nil }) else { return }
        await saveResult(at: index)
    }

    private func saveResult(at index: Int) async {
        guard let output = jobs[index].result else { return }
        jobs[index].saving = true
        jobs[index].saveError = nil
        jobs[index].message = output.movie == nil ? "Saving to Photos…" : "Saving Live Photo…"
        defer { jobs[index].saving = false }
        do {
            var authorization = PHPhotoLibrary.authorizationStatus(for: .addOnly)
            if authorization == .notDetermined { authorization = await PHPhotoLibrary.requestAuthorization(for: .addOnly) }
            guard authorization == .authorized || authorization == .limited else { throw ProcessingError.photosAccess }
            try await PHPhotoLibrary.shared().performChanges {
                let creation = PHAssetCreationRequest.forAsset()
                creation.creationDate = output.date
                creation.location = output.location
                creation.addResource(with: .photo, fileURL: output.photo, options: nil)
                if let movie = output.movie { creation.addResource(with: .pairedVideo, fileURL: movie, options: nil) }
            }
            jobs[index].message = output.movie == nil ? "Saved to Photos" : "Live Photo saved to Photos"
        } catch {
            jobs[index].message = "Couldn’t save to Photos"
            jobs[index].saveError = error.localizedDescription
        }
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
        do {
            try Task.checkCancellation()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            jobs[index].message = "Reading the original photo…"
            var files = try await stage(input, in: folder)
            var asset: PHAsset? = if case .photo(let asset) = input { asset } else { nil }
            var wasLivePhoto = files.movie != nil || asset?.mediaSubtypes.contains(.photoLive) == true
            var captureDate: Date?
            var sourceName = input.name
            if recoverLivePhoto, let info = try await engine.inspectLivePhoto(files.input), files.movie == nil || info.isJPEG {
                wasLivePhoto = true
                captureDate = info.captureDate
                jobs[index].message = "Finding the original Live Photo motion…"
                let motion = folder.appendingPathComponent("recovered.mov")
                if let match = try await ShortcutLivePhotoLookup.copyMotion(for: info, filename: input.name, to: motion) {
                    if !info.isJPEG {
                        asset = match
                        files = ProcessingFiles(input: files.input, movie: motion, movieOutput: files.movieOutput, output: files.output)
                    } else if let original = try await recoverOriginalStill(match, identifier: info.identifier, in: folder) {
                        asset = match
                        sourceName = original.name
                        try? FileManager.default.removeItem(at: files.input)
                        if let movie = files.movie { try? FileManager.default.removeItem(at: movie) }
                        files = ProcessingFiles(input: original.url, movie: motion, movieOutput: files.movieOutput, output: files.output)
                    } else {
                        try? FileManager.default.removeItem(at: motion)
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
            jobs[index].result = Output(photo: photo, movie: movie, notes: notes, date: asset?.creationDate ?? captureDate,
                                        location: asset?.location, lostMotion: wasLivePhoto && movie == nil,
                                        depthWarning: result.depthWarning)
            jobs[index].progress = nil
            await saveResult(at: index)
        } catch {
            try? FileManager.default.removeItem(at: folder)
            jobs[index].failed = true
            jobs[index].message = error.localizedDescription
            jobs[index].progress = nil
        }
    }

    private func recoverOriginalStill(_ asset: PHAsset, identifier: String, in folder: URL) async throws -> (url: URL, name: String)? {
        guard let photo = PhotoLibrary.originalPhoto(in: PHAssetResource.assetResources(for: asset)) else { return nil }
        let still = folder.appendingPathComponent("recovered.heic")
        do {
            try await Self.write(photo, to: still)
            if let info = try await engine.inspectLivePhoto(still), !info.isJPEG, info.identifier == identifier {
                return (still, photo.originalFilename)
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
