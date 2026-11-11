import Photos
import SwiftUI
import UIKit

struct AlbumsView: View {
    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var processing: PhotoProcessing
    @Environment(\.openURL) private var openURL
    @State private var isShowingResults = false

    var body: some View {
        Group {
            switch library.authorization {
            case .authorized, .limited:
                if library.assets == nil {
                    ProgressView("Loading Albums")
                } else if library.myAlbums.isEmpty && library.smartAlbums.isEmpty {
                    ContentUnavailableView("No Albums", systemImage: "rectangle.stack")
                } else {
                    List {
                        if !library.myAlbums.isEmpty {
                            Section("My Albums") { rows(library.myAlbums) }
                        }
                        if !library.smartAlbums.isEmpty {
                            Section("Media Types and Favorites") { rows(library.smartAlbums) }
                        }
                    }
                }
            case .notDetermined:
                ProgressView("Waiting for Photos Access")
            case .denied:
                ContentUnavailableView {
                    Label("Allow Photos Access", systemImage: "lock")
                } description: {
                    Text("Allow access in Settings to browse your iPhone albums.")
                } actions: {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .buttonStyle(.borderedProminent)
                }
            default:
                ContentUnavailableView("Albums Unavailable", systemImage: "rectangle.stack")
            }
        }
        .navigationTitle("Albums")
        .toolbar {
            if !processing.jobs.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    ProcessingResultsButton { isShowingResults = true }
                }
            }
        }
        .sheet(isPresented: $isShowingResults) { ProcessingResultsView() }
    }

    private func rows(_ albums: [PhotoLibrary.Album]) -> some View {
        ForEach(albums) { album in
            NavigationLink {
                ProcessView(album: album.collection)
            } label: {
                Label {
                    LabeledContent(album.title) { Text(album.count, format: .number) }
                } icon: {
                    Image(systemName: symbol(for: album.collection.assetCollectionSubtype))
                }
            }
        }
    }

    private func symbol(for subtype: PHAssetCollectionSubtype) -> String {
        switch subtype {
        case .smartAlbumFavorites: "heart"
        case .smartAlbumLivePhotos: "livephoto"
        case .smartAlbumDepthEffect: "person.crop.rectangle"
        case .smartAlbumSelfPortraits: "person.crop.square"
        case .smartAlbumScreenshots: "camera.viewfinder"
        case .smartAlbumPanoramas: "pano"
        default: "rectangle.stack"
        }
    }
}
