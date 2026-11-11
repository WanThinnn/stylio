import Combine
import Foundation
import Photos

@MainActor
final class PhotoLibrary: NSObject, ObservableObject, PHPhotoLibraryChangeObserver {
    @Published private(set) var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @Published private(set) var assets: PHFetchResult<PHAsset>?
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
            selection = []
            return
        }

        if !isObserving {
            PHPhotoLibrary.shared().register(self)
            isObserving = true
        }
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        assets = PHAsset.fetchAssets(with: .image, options: options)

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

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor [weak self] in self?.refresh() }
    }
}
