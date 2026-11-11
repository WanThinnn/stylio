import CoreLocation
import Photos
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct PhotoDetailSelection: Identifiable {
    let photos: PhotoAssets
    let index: Int
    var id: String { photos[index].localIdentifier }
}

struct PhotoDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @EnvironmentObject private var processing: PhotoProcessing
    @State private var index: Int
    @State private var pageIndex: Int?
    @State private var filename = ""
    @State private var isFavorite = false
    @State private var changingFavorite = false
    @State private var showsInfo = false
    @State private var showsResults = false
    @State private var error: String?
    @State private var livePhoto: PHLivePhoto?
    @State private var liveRequest: PHImageRequestID?
    @State private var liveToken: UUID?

    private let photos: PhotoAssets
    private let onPageChange: (String) -> Void
    private var asset: PHAsset { photos[index] }
    private var isLive: Bool { asset.mediaSubtypes.contains(.photoLive) }
    private var filmstripIndices: Range<Int> { max(0, index - 12)..<min(photos.count, index + 13) }

    init(selection: PhotoDetailSelection, onPageChange: @escaping (String) -> Void) {
        photos = selection.photos
        self.onPageChange = onPageChange
        _index = State(initialValue: selection.index)
        _pageIndex = State(initialValue: selection.index)
    }

    var body: some View {
        VStack(spacing: 10) {
            header
            GeometryReader { geometry in
                photoPager(size: geometry.size)
            }
            if photos.count > 1 { filmstrip }
            actions
        }
        .padding(.vertical, 5)
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .onAppear { updatePhoto() }
        .onDisappear { stopLivePhoto() }
        .onChange(of: pageIndex) { _, position in
            guard let position, (0..<photos.count).contains(position), position != index else { return }
            stopLivePhoto()
            index = position
            updatePhoto()
            onPageChange(asset.localIdentifier)
        }
        .sheet(isPresented: $showsInfo) { infoSheet }
        .sheet(isPresented: $showsResults) { ProcessingResultsView() }
        .alert("Photo", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) { error = nil }
        } message: { Text(error ?? "") }
    }

    private func photoPager(size: CGSize) -> some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(0..<photos.count, id: \.self) { position in
                    ZStack {
                        PhotoThumbnail(asset: photos[position], size: size, contentMode: .aspectFit)
                        if position == index, let livePhoto {
                            LivePhotoPlayback(photo: livePhoto).allowsHitTesting(false)
                        }
                    }
                    .frame(width: size.width, height: size.height)
                    .id(position)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $pageIndex)
        .overlay(alignment: .topLeading) {
            if isLive {
                Button { playLivePhoto(size: size) } label: {
                    Label("Live", systemImage: "livephoto")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10)
                        .frame(minHeight: 36)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .stylioGlass(in: Capsule())
                .accessibilityLabel("Play Live Photo")
                .disabled(liveToken != nil)
                .padding(12)
            }
        }
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: choose(index + 1)
            case .decrement: choose(index - 1)
            @unknown default: break
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            iconButton("Back", icon: "chevron.left") { dismiss() }
            VStack(spacing: 2) {
                if let date = asset.creationDate {
                    Text(date, format: .dateTime.month(.abbreviated).day().year())
                        .font(.headline)
                    Text(date, style: .time).font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(filename.isEmpty ? "Photo" : filename).font(.headline)
                }
            }
            .lineLimit(1)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .stylioGlass(in: Capsule())
            .frame(maxWidth: .infinity)

            Menu {
                Button("Photo Info", systemImage: "info.circle") { showsInfo = true }
                if !filename.isEmpty {
                    Button("Copy Filename", systemImage: "doc.on.doc") { UIPasteboard.general.string = filename }
                }
            } label: {
                Image(systemName: "ellipsis").font(.headline).frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .stylioGlass(in: Circle())
            .accessibilityLabel("Photo Options")
        }
        .padding(.horizontal, 16)
    }

    private var filmstrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 5) {
                    ForEach(filmstripIndices, id: \.self) { position in
                        Button { choose(position) } label: {
                            PhotoThumbnail(asset: photos[position], size: CGSize(width: position == index ? 43 : 30, height: 50))
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                                .overlay {
                                    if position == index {
                                        RoundedRectangle(cornerRadius: 5).strokeBorder(Color.accentColor, lineWidth: 2)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Photo \(position + 1)")
                        .accessibilityAddTraits(position == index ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .onAppear { proxy.scrollTo(index, anchor: .center) }
            .onChange(of: index) { _, newIndex in proxy.scrollTo(newIndex, anchor: .center) }
        }
        .frame(height: 50)
    }

    private var actions: some View {
        VStack(spacing: 10) {
            addStylesButton
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .disabled(processing.isBusy)
            HStack(spacing: 8) {
                Button { changeFavorite() } label: {
                    Image(systemName: isFavorite ? "heart.fill" : "heart")
                        .foregroundStyle(isFavorite ? Color.red : Color.primary)
                        .frame(width: 44, height: 44)
                }
                .disabled(changingFavorite)
                .accessibilityLabel(isFavorite ? "Remove from Favorites" : "Add to Favorites")
                Button { showsInfo = true } label: {
                    Image(systemName: "info.circle").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Photo Info")
                if !processing.jobs.isEmpty {
                    ProcessingResultsButton { showsResults = true }
                        .frame(width: 44, height: 44)
                }
            }
            .font(.title3)
            .buttonStyle(.plain)
            .padding(.horizontal, 6)
            .stylioGlass(in: Capsule())
        }
    }

    @ViewBuilder private var addStylesButton: some View {
        let button = Button("Add Styles", systemImage: "camera.filters", action: processPhoto)
        if #available(iOS 26.0, *) {
            button.buttonStyle(.glassProminent)
        } else {
            button.buttonStyle(.borderedProminent)
        }
    }

    private var infoSheet: some View {
        NavigationStack {
            List {
                Section {
                    if !filename.isEmpty { LabeledContent("Filename", value: filename) }
                    if let date = asset.creationDate {
                        LabeledContent("Captured") { Text(date.formatted(date: .abbreviated, time: .shortened)) }
                    }
                    LabeledContent("Dimensions", value: "\(asset.pixelWidth) × \(asset.pixelHeight)")
                    if let type = UTType(filenameExtension: (filename as NSString).pathExtension), let description = type.localizedDescription {
                        LabeledContent("Format", value: description)
                    }
                    if isLive { Label("Live Photo", systemImage: "livephoto") }
                }
                if let location = asset.location {
                    Section("Location") {
                        LabeledContent("Latitude") { Text(location.coordinate.latitude, format: .number.precision(.fractionLength(5))) }
                        LabeledContent("Longitude") { Text(location.coordinate.longitude, format: .number.precision(.fractionLength(5))) }
                    }
                }
            }
            .navigationTitle("Photo Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showsInfo = false } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func iconButton(_ title: LocalizedStringKey, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.headline).frame(width: 44, height: 44).contentShape(Circle())
        }
        .buttonStyle(.plain)
        .stylioGlass(in: Circle())
        .accessibilityLabel(title)
    }

    private func choose(_ position: Int) {
        guard position >= 0, position < photos.count, position != index else { return }
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) { pageIndex = position }
    }

    private func updatePhoto() {
        filename = PhotoLibrary.originalPhoto(in: PHAssetResource.assetResources(for: asset))?.originalFilename ?? ""
        let current = PHAsset.fetchAssets(withLocalIdentifiers: [asset.localIdentifier], options: nil).firstObject
        isFavorite = current?.isFavorite ?? asset.isFavorite
    }

    private func processPhoto() {
        do {
            try processing.start(assets: [asset], files: [])
        } catch let failure {
            error = failure.localizedDescription
        }
    }

    private func changeFavorite() {
        let photo = asset, newValue = !isFavorite
        changingFavorite = true
        Task {
            defer { changingFavorite = false }
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetChangeRequest(for: photo).isFavorite = newValue
                }
                if photo.localIdentifier == asset.localIdentifier { isFavorite = newValue }
            } catch let failure {
                error = failure.localizedDescription
            }
        }
    }

    private func playLivePhoto(size: CGSize) {
        stopLivePhoto()
        let token = UUID()
        liveToken = token
        let options = PHLivePhotoRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        liveRequest = PHImageManager.default().requestLivePhoto(for: asset, targetSize: size, contentMode: .aspectFit, options: options) { photo, info in
            guard info?[PHImageResultIsDegradedKey] as? Bool != true else { return }
            Task { @MainActor in
                guard liveToken == token else { return }
                liveRequest = nil
                liveToken = nil
                livePhoto = photo
                if photo == nil { error = "Couldn’t load the Live Photo motion." }
            }
        }
    }

    private func stopLivePhoto() {
        liveToken = nil
        if let liveRequest { PHImageManager.default().cancelImageRequest(liveRequest) }
        liveRequest = nil
        livePhoto = nil
    }
}

private struct LivePhotoPlayback: UIViewRepresentable {
    let photo: PHLivePhoto

    func makeUIView(context: Context) -> PHLivePhotoView {
        let view = PHLivePhotoView()
        view.contentMode = .scaleAspectFit
        return view
    }

    func updateUIView(_ view: PHLivePhotoView, context: Context) {
        if view.livePhoto !== photo {
            view.livePhoto = photo
            view.startPlayback(with: .full)
        }
    }
}
