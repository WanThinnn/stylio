import Combine
import Foundation
import Photos

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
    @Published private(set) var selection: Set<String> = []
    private var isObserving = false

    deinit {
        if isObserving { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
    }

    func requestAccessIfNeeded() async {
        if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined {
            _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        }
        refresh()
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
            selection = []
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

        if !selection.isEmpty {
            let available = PHAsset.fetchAssets(withLocalIdentifiers: Array(selection), options: nil)
            selection = Set((0..<available.count).map { available.object(at: $0).localIdentifier })
        }
    }

    func toggleSelection(of asset: PHAsset) {
        if selection.remove(asset.localIdentifier) == nil {
            selection.insert(asset.localIdentifier)
        }
    }

    func clearSelection() { selection = [] }

    func selectedAssets() -> [PHAsset] {
        guard !selection.isEmpty else { return [] }
        let result = PHAsset.fetchAssets(withLocalIdentifiers: Array(selection), options: Self.photoOptions())
        return (0..<result.count).map { result.object(at: $0) }
    }

    static func photoOptions(sorted: Bool = true) -> PHFetchOptions {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        if sorted { options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)] }
        return options
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
