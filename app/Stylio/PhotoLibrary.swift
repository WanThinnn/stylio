import Combine
import Foundation
import Photos

enum LibrarySort: String, CaseIterable {
    case captured, modified

    var key: String { self == .captured ? "creationDate" : "modificationDate" }
}

struct PhotoAssets {
    private let fetchResult: PHFetchResult<PHAsset>?
    private let matches: [PHAsset]

    init(_ fetchResult: PHFetchResult<PHAsset>) {
        self.fetchResult = fetchResult
        matches = []
    }

    init(_ matches: [PHAsset]) {
        fetchResult = nil
        self.matches = matches
    }

    var count: Int { fetchResult?.count ?? matches.count }
    subscript(_ index: Int) -> PHAsset { fetchResult?.object(at: index) ?? matches[index] }
}

@MainActor
final class PhotoLibrary: NSObject, ObservableObject, PHPhotoLibraryChangeObserver {
    struct Album: Identifiable {
        let collection: PHAssetCollection
        let count: Int
        var id: String { collection.localIdentifier }
        var title: String { collection.localizedTitle ?? "Album" }
    }

    @Published private(set) var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @Published private(set) var assets: PHFetchResult<PHAsset>?
    @Published private(set) var myAlbums: [Album] = []
    @Published private(set) var smartAlbums: [Album] = []
    private var isObserving = false
    private static var readAccessRequest: Task<PHAuthorizationStatus, Never>?

    deinit {
        if isObserving { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
    }

    func requestAccessIfNeeded() async {
        _ = await Self.authorizeReading()
        refresh()
    }

    static func authorizeReading() async -> PHAuthorizationStatus {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .notDetermined else { return status }
        if let readAccessRequest { return await readAccessRequest.value }
        let task = Task { await PHPhotoLibrary.requestAuthorization(for: .readWrite) }
        readAccessRequest = task
        defer { readAccessRequest = nil }
        return await task.value
    }

    func refresh() {
        authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard authorization == .authorized || authorization == .limited else {
            if isObserving {
                PHPhotoLibrary.shared().unregisterChangeObserver(self)
                isObserving = false
            }
            assets = nil
            myAlbums = []
            smartAlbums = []
            return
        }
        if !isObserving {
            PHPhotoLibrary.shared().register(self)
            isObserving = true
        }
        assets = PHAsset.fetchAssets(with: .image, options: Self.photoOptions())
        myAlbums = albums(from: PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil), showEmpty: true)
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        let smartTypes: [PHAssetCollectionSubtype] = [
            .smartAlbumFavorites, .smartAlbumLivePhotos, .smartAlbumDepthEffect,
            .smartAlbumSelfPortraits, .smartAlbumScreenshots, .smartAlbumPanoramas,
        ]
        smartAlbums = smartTypes.flatMap {
            albums(from: PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: $0, options: nil), showEmpty: false)
        }
    }

    func selectedAssets(_ identifiers: Set<String>, sort: LibrarySort, ascending: Bool) -> [PHAsset] {
        guard !identifiers.isEmpty else { return [] }
        let result = PHAsset.fetchAssets(withLocalIdentifiers: Array(identifiers), options: Self.photoOptions(sort: sort, ascending: ascending))
        return (0..<result.count).map { result.object(at: $0) }
    }

    nonisolated static func photoOptions(sorted: Bool = true, sort: LibrarySort = .captured, ascending: Bool = false) -> PHFetchOptions {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        if sorted { options.sortDescriptors = [NSSortDescriptor(key: sort.key, ascending: ascending)] }
        return options
    }

    nonisolated static func originalPhoto(in resources: [PHAssetResource]) -> PHAssetResource? {
        resources.first { $0.type == .photo } ?? resources.first { $0.type == .fullSizePhoto }
    }

    private func albums(from result: PHFetchResult<PHAssetCollection>, showEmpty: Bool) -> [Album] {
        let options = Self.photoOptions(sorted: false)
        return (0..<result.count).compactMap { index in
            let album = result.object(at: index)
            let count = PHAsset.fetchAssets(in: album, options: options).count
            return showEmpty || count > 0 ? Album(collection: album, count: count) : nil
        }
    }

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor [weak self] in self?.refresh() }
    }
}

enum PhotoSearch {
    static func matches(query: String, in assets: PHFetchResult<PHAsset>, albums: [PhotoLibrary.Album]) -> [PHAsset] {
        let tokens = query.split(whereSeparator: \.isWhitespace).map(String.init)
        let albumMatches = matchingAlbums(for: tokens, albums: albums)
        let longDate = DateFormatter()
        longDate.setLocalizedDateFormatFromTemplate("EEEE MMMM d yyyy")
        let numericDate = DateFormatter()
        numericDate.setLocalizedDateFormatFromTemplate("yyyyMd")
        var photos: [PHAsset] = []
        for index in 0..<assets.count {
            if Task.isCancelled { return [] }
            let asset = assets.object(at: index)
            var terms = albumMatches[asset.localIdentifier, default: []] + keywords(for: asset)
            if let date = asset.creationDate {
                terms += [longDate.string(from: date), numericDate.string(from: date)]
            }
            let remaining = tokens.filter { token in !terms.contains { $0.localizedStandardContains(token) } }
            if remaining.isEmpty || filenameMatches(asset, tokens: remaining) {
                photos.append(asset)
            }
        }
        return photos
    }

    private static func filenameMatches(_ asset: PHAsset, tokens: [String]) -> Bool {
        guard let filename = PhotoLibrary.originalPhoto(in: PHAssetResource.assetResources(for: asset))?.originalFilename else { return false }
        return tokens.allSatisfy { filename.localizedStandardContains($0) }
    }

    private static func matchingAlbums(for tokens: [String], albums: [PhotoLibrary.Album]) -> [String: [String]] {
        var names: [String: [String]] = [:]
        for album in albums where tokens.contains(where: { album.title.localizedStandardContains($0) }) {
            let result = PHAsset.fetchAssets(in: album.collection, options: PhotoLibrary.photoOptions(sorted: false))
            for index in 0..<result.count {
                if Task.isCancelled { return [:] }
                names[result.object(at: index).localIdentifier, default: []].append(album.title)
            }
        }
        return names
    }

    private static func keywords(for asset: PHAsset) -> [String] {
        let kinds = asset.mediaSubtypes
        var terms: [String] = []
        if kinds.contains(.photoLive) { terms.append("Live Photo") }
        if kinds.contains(.photoDepthEffect) { terms.append("Portrait") }
        if kinds.contains(.photoScreenshot) { terms.append("Screenshot") }
        if kinds.contains(.photoPanorama) { terms.append("Panorama") }
        if kinds.contains(.photoHDR) { terms.append("HDR") }
        if asset.isFavorite { terms.append("Favorites") }
        return terms
    }
}
