import Foundation
import Photos
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ProcessView: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var library = PhotoLibrary()
    @State private var files: [URL] = []
    @State private var isImportingFiles = false
    @State private var importError: String?

    var body: some View {
        libraryContent
            .navigationTitle("Library")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Import from Files", systemImage: "folder") {
                            isImportingFiles = true
                        }
                        if library.authorization == .limited {
                            Button("Manage Photos Access", systemImage: "lock") {
                                openAppSettings()
                            }
                        }
                    } label: {
                        Label("Library Options", systemImage: "ellipsis.circle")
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if !library.selection.isEmpty || !files.isEmpty {
                    selectionBar
                }
            }
            .task { await library.requestAccessIfNeeded() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { library.refresh() }
            }
            .fileImporter(
                isPresented: $isImportingFiles,
                allowedContentTypes: [.image, .rawImage, .quickTimeMovie],
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case .success(let selection): files = selection
                case .failure(let error): importError = error.localizedDescription
                }
            }
            .alert("Couldn’t select files", isPresented: showsImportError, presenting: importError) { _ in
                Button("OK", role: .cancel) { importError = nil }
            } message: { error in
                Text(error)
            }
    }

    @ViewBuilder
    private var libraryContent: some View {
        switch library.authorization {
        case .authorized, .limited:
            if let assets = library.assets {
                if assets.count > 0 {
                    photoGrid(assets)
                } else if library.authorization == .limited {
                    accessMessage("No Photos Shared", description: "Manage Photos access to add photos to this library.")
                } else {
                    ContentUnavailableView("No Photos", systemImage: "photo.on.rectangle")
                }
            } else {
                ProgressView("Loading Photos")
            }
        case .notDetermined:
            ProgressView("Waiting for Photos Access")
        case .denied:
            accessMessage("Allow Photos Access", description: "Allow access in Settings to browse your photo library in Stylio.")
        case .restricted:
            ContentUnavailableView(
                "Photos Access Restricted",
                systemImage: "lock",
                description: Text("Your device settings restrict access to Photos.")
            )
        @unknown default:
            ContentUnavailableView("Photos Unavailable", systemImage: "photo.on.rectangle")
        }
    }

    private func photoGrid(_ assets: PHFetchResult<PHAsset>) -> some View {
        GeometryReader { geometry in
            let spacing: CGFloat = 2
            let columns = max(3, Int(geometry.size.width / 120))
            let side = max(1, (geometry.size.width - CGFloat(columns - 1) * spacing) / CGFloat(columns))

            ScrollView {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.fixed(side), spacing: spacing), count: columns),
                    spacing: spacing
                ) {
                    ForEach(0..<assets.count, id: \.self) { index in
                        let asset = assets.object(at: index)
                        PhotoTile(asset: asset, side: side, isSelected: library.selection.contains(asset.localIdentifier)) {
                            library.toggleSelection(of: asset)
                        }
                        .id(asset.localIdentifier)
                    }
                }
            }
        }
    }

    private var selectionBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !files.isEmpty {
                DisclosureGroup("Files (\(files.count))") {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(files, id: \.self) { file in
                                Label(file.lastPathComponent, systemImage: "doc")
                                    .font(.subheadline)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 120)
                }
            }

            HStack {
                Text("Selected: \(library.selection.count + files.count)")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button("Clear") {
                    library.clearSelection()
                    files = []
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func accessMessage(_ title: LocalizedStringKey, description: LocalizedStringKey) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: "lock")
        } description: {
            Text(description)
        } actions: {
            Button("Open Settings") { openAppSettings() }
                .buttonStyle(.borderedProminent)
        }
    }

    private var showsImportError: Binding<Bool> {
        Binding(
            get: { importError != nil },
            set: { if !$0 { importError = nil } }
        )
    }

    private func openAppSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        openURL(url)
    }
}

private struct PhotoTile: View {
    @Environment(\.displayScale) private var displayScale
    @State private var thumbnail: UIImage?
    @State private var imageRequest: PHImageRequestID?
    @State private var requestToken: UUID?

    let asset: PHAsset
    let side: CGFloat
    let isSelected: Bool
    let onSelect: () -> Void

    private static let imageManager = PHCachingImageManager()

    var body: some View {
        Button(action: onSelect) {
            ZStack {
                Rectangle().fill(Color(uiColor: .secondarySystemBackground))
                if let thumbnail {
                    Image(uiImage: thumbnail)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: side, height: side)
            .clipped()
            .contentShape(Rectangle())
            .overlay(alignment: .bottomLeading) {
                if asset.mediaSubtypes.contains(.photoLive) {
                    Image(systemName: "livephoto")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .shadow(radius: 2)
                        .padding(6)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, Color.accentColor)
                        .padding(6)
                }
            }
            .overlay {
                if isSelected {
                    Rectangle().strokeBorder(Color.accentColor, lineWidth: 3)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(asset.mediaSubtypes.contains(.photoLive) ? Text("Live Photo") : Text("Photo"))
        .accessibilityValue(asset.creationDate.map { Text($0, style: .date) } ?? Text(""))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .onAppear { loadThumbnail() }
        .onChange(of: pixelSide) { _, _ in
            if requestToken != nil { loadThumbnail() }
        }
        .onChange(of: asset.modificationDate) { _, _ in
            if requestToken != nil { loadThumbnail() }
        }
        .onDisappear { cancelThumbnail() }
    }

    private var pixelSide: CGFloat { ceil(side * displayScale) }

    private func loadThumbnail() {
        cancelThumbnail()
        let token = UUID()
        requestToken = token
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true

        imageRequest = Self.imageManager.requestImage(
            for: asset,
            targetSize: CGSize(width: pixelSide, height: pixelSide),
            contentMode: .aspectFill,
            options: options
        ) { image, _ in
            guard let image else { return }
            Task { @MainActor in
                if requestToken == token { thumbnail = image }
            }
        }
    }

    private func cancelThumbnail() {
        requestToken = nil
        if let imageRequest {
            Self.imageManager.cancelImageRequest(imageRequest)
        }
        imageRequest = nil
        thumbnail = nil
    }
}
