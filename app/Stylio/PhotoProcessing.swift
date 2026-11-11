import Combine
import CoreLocation
import Foundation
import Photos
import UIKit

@MainActor
final class PhotoProcessing: ObservableObject {
    enum Input {
        case photo(PHAsset)
        case file(URL, movie: URL?)

        var name: String {
            switch self {
            case .photo(let asset):
                PhotoProcessing.originalPhoto(in: PHAssetResource.assetResources(for: asset))?.originalFilename ?? "Photo"
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
        var saved = false
        var saveError: String?
    }

    struct Output {
        let photo: URL
        let movie: URL?
        let notes: [String]
        let date: Date?
        let location: CLLocation?
    }

    private enum ProcessingError: LocalizedError {
        case photoUnavailable, photosAccess, unsupportedMovie, emptySelection

        var errorDescription: String? {
            switch self {
            case .photoUnavailable: "The original photo could not be read from Photos."
            case .photosAccess: "Allow Stylio to add photos in the iOS Settings app."
            case .unsupportedMovie: "Select the still image alongside its Live Photo MOV."
            case .emptySelection: "Select a photo to process."
            }
        }
    }

    @Published private(set) var jobs: [Job] = []
    @Published private(set) var isProcessing = false
    @Published private(set) var isMaintaining = false
    @Published private(set) var resetCount = 0
    var isBusy: Bool { isProcessing || isMaintaining || jobs.contains(where: \.saving) }

    private let engine = NativeEngine()
    private let workDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("StylioProcessing", isDirectory: true)

    init() { try? FileManager.default.removeItem(at: workDirectory) }

    func start(assets: [PHAsset], files: [URL]) throws {
        guard !isBusy else { return }
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

        if FileManager.default.fileExists(atPath: workDirectory.path) {
            try FileManager.default.removeItem(at: workDirectory)
        }
        jobs = inputs.map { Job(name: $0.name) }
        isProcessing = true
        let preferences = UserDefaults.standard
        let options: [String: Any] = [
            "portrait": preferences.bool(forKey: "stylio.ai.portrait"),
            "detail": preferences.bool(forKey: "stylio.ai.detail"),
            "style": preferences.bool(forKey: "stylio.ai.style"),
            "gpu": preferences.object(forKey: "stylio.ai.gpu") as? Bool ?? true,
            "model": preferences.string(forKey: "stylio.ai.model") ?? "standard",
        ]
        Task {
            let idleTimerWasDisabled = UIApplication.shared.isIdleTimerDisabled
            if preferences.bool(forKey: "stylio.keepScreenAwake") { UIApplication.shared.isIdleTimerDisabled = true }
            defer {
                UIApplication.shared.isIdleTimerDisabled = idleTimerWasDisabled
                isProcessing = false
            }
            for (index, input) in inputs.enumerated() {
                await process(input, at: index, options: options)
            }
        }
    }

    func save(_ id: UUID) async {
        guard let index = jobs.firstIndex(where: { $0.id == id }), let output = jobs[index].result,
              !jobs[index].saving, !jobs[index].saved, !isMaintaining else { return }
        jobs[index].saving = true
        jobs[index].saveError = nil
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
            jobs[index].saved = true
        } catch {
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

    private func process(_ input: Input, at index: Int, options: [String: Any]) async {
        let folder = workDirectory.appendingPathComponent(jobs[index].id.uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            jobs[index].message = "Reading the original photo…"
            let files = try await stage(input, in: folder)
            let result = try await engine.process(files, name: input.name, options: options) { [weak self] message, progress in
                if let message { self?.jobs[index].message = message }
                if let progress { self?.jobs[index].progress = min(max(progress, 0), 100) }
            }
            var notes = result.notes
            var movie: URL?
            switch result.movie {
            case .none:
                if case .photo(let asset) = input, asset.mediaSubtypes.contains(.photoLive) {
                    notes.append("The paired video could not be found. The result can be saved as a still photo.")
                }
            case .compatible: movie = files.movie
            case .repaired: movie = files.movieOutput
            case .needsTracks: notes.append("The original motion lacks the metadata this edit needs. The result can be saved as a still photo.")
            case .mismatch: notes.append("The image and video pairing IDs could not be verified. The result can be saved as a still photo.")
            }
            if let originalMovie = files.movie, originalMovie != movie { try? FileManager.default.removeItem(at: originalMovie) }
            try? FileManager.default.removeItem(at: files.input)
            let photo = folder.appendingPathComponent(URL(fileURLWithPath: result.name).lastPathComponent)
            if photo != files.output { try FileManager.default.moveItem(at: files.output, to: photo) }
            let asset: PHAsset? = if case .photo(let asset) = input { asset } else { nil }
            jobs[index].result = Output(photo: photo, movie: movie, notes: notes, date: asset?.creationDate, location: asset?.location)
            jobs[index].message = movie == nil ? "Ready to save" : "Live Photo ready to save"
            jobs[index].progress = nil
        } catch {
            try? FileManager.default.removeItem(at: folder)
            jobs[index].failed = true
            jobs[index].message = error.localizedDescription
            jobs[index].progress = nil
        }
    }

    private func stage(_ input: Input, in folder: URL) async throws -> ProcessingFiles {
        let movieDestination = folder.appendingPathComponent("original.mov")
        let movieOutput = folder.appendingPathComponent("processed.mov")
        let output = folder.appendingPathComponent("processed.heic")
        switch input {
        case .photo(let asset):
            let resources = PHAssetResource.assetResources(for: asset)
            guard let photo = Self.originalPhoto(in: resources) else { throw ProcessingError.photoUnavailable }
            let still = folder.appendingPathComponent("input").appendingPathExtension(URL(fileURLWithPath: photo.originalFilename).pathExtension)
            try await write(photo, to: still)
            let movie = asset.mediaSubtypes.contains(.photoLive) ? resources.first { $0.type == .pairedVideo } : nil
            if let movie { try await write(movie, to: movieDestination) }
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

    private nonisolated static func originalPhoto(in resources: [PHAssetResource]) -> PHAssetResource? {
        resources.first { $0.type == .photo } ?? resources.first { $0.type == .fullSizePhoto }
    }

    private func write(_ resource: PHAssetResource, to destination: URL) async throws {
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        try await PHAssetResourceManager.default().writeData(for: resource, toFile: destination, options: options)
    }

    private nonisolated static func copyImported(_ source: URL, to destination: URL) throws {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        try FileManager.default.copyItem(at: source, to: destination)
    }
}
