import Photos
import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum LibraryTimeline: String, CaseIterable {
    case year, month, all

    var title: LocalizedStringKey {
        switch self {
        case .year: "Year"
        case .month: "Month"
        case .all: "All"
        }
    }

    func period(for date: Date?, calendar: Calendar = .current) -> Date? {
        guard let date, self != .all else { return nil }
        return calendar.dateInterval(of: self == .year ? .year : .month, for: date)?.start
    }
}

struct ProcessView: View {
    let album: PHAssetCollection?
    let isSearch: Bool
    @Binding var timeline: LibraryTimeline
    @Binding private var query: String

    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var library: PhotoLibrary
    @EnvironmentObject private var processing: PhotoProcessing
    @AppStorage("stylio.library.sort") private var sort = LibrarySort.captured
    @AppStorage("stylio.library.ascending") private var ascending = false
    @State private var assets: PHFetchResult<PHAsset>?
    @State private var periods: [Period] = []
    @State private var scrollTarget: ScrollTarget?
    @State private var selection: Set<String> = []
    @State private var selecting = false
    @State private var files: [URL] = []
    @State private var isImportingFiles = false
    @State private var error: String?
    @State private var showsResults = false
    @State private var detail: PhotoDetailSelection?
    @State private var detailZoomID: String?
    @State private var matches: SearchResult?
    @Namespace private var photoTransition

    init(album: PHAssetCollection? = nil, timeline: Binding<LibraryTimeline> = .constant(.all), searchText: Binding<String>? = nil) {
        self.album = album
        isSearch = searchText != nil
        _timeline = timeline
        _query = searchText ?? .constant("")
    }

    private struct Period: Identifiable {
        let date: Date?
        let index: Int
        var id: Date? { date }
    }

    private enum ScrollTarget: Hashable {
        case photo(String)
        case period(Date?)
    }

    private struct SearchRequest: Equatable {
        let query: String
        let source: ObjectIdentifier?
    }

    private struct SearchResult {
        let request: SearchRequest
        let photos: [PHAsset]
    }

    private var mode: LibraryTimeline { selecting || isSearch ? .all : timeline }
    private var searchRequest: SearchRequest {
        SearchRequest(query: query.trimmingCharacters(in: .whitespacesAndNewlines), source: assets.map { ObjectIdentifier($0) })
    }
    private var visiblePhotos: PhotoAssets? {
        if isSearch {
            guard let matches, matches.request == searchRequest else { return nil }
            return PhotoAssets(matches.photos)
        }
        return assets.map { PhotoAssets($0) }
    }

    var body: some View {
        searchPresentation
            .navigationTitle(isSearch ? "Search" : (album?.localizedTitle ?? "Library"))
            .modifier(LibraryNavigationChrome(isSearch: isSearch, selecting: selecting))
            .toolbar {
                if !isSearch && selecting, let photos = visiblePhotos, photos.count > 0 {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Select All") { selectAll(photos) }
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !processing.jobs.isEmpty {
                        Button("Processing Results", systemImage: "tray") { showsResults = true }
                    }
                    if let photos = visiblePhotos, photos.count > 0 {
                        if !isSearch { sortMenu }
                        Button(selecting ? "Cancel" : "Select", action: toggleSelecting)
                    }
                    if !isSearch && (album == nil || library.authorization == .limited) { importMenu }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if selecting || !files.isEmpty { selectionBar }
            }
            .onReceive(library.$assets) { refreshAssets($0) }
            .onChange(of: sort) { _, _ in refreshAssets(library.assets) }
            .onChange(of: ascending) { _, _ in refreshAssets(library.assets) }
            .onChange(of: mode) { _, _ in updatePeriods() }
            .onChange(of: processing.resetCount) { _, _ in clearSelection(); files = [] }
            .sheet(isPresented: $showsResults) { ProcessingResultsView() }
            .fullScreenCover(item: $detail, content: photoDetail)
            .fileImporter(isPresented: $isImportingFiles, allowedContentTypes: [.image, .rawImage, .quickTimeMovie], allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls): files = urls
                case .failure(let failure): error = failure.localizedDescription
                }
            }
            .alert("Couldn’t continue", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) { error = nil }
            } message: { Text(error ?? "") }
    }

    @ViewBuilder private var searchPresentation: some View {
        if isSearch {
            let request = searchRequest
            libraryContent
                .task(id: request) { await search(request) }
                .onChange(of: query) { _, _ in clearSelection() }
        } else {
            libraryContent
        }
    }

    @ViewBuilder private var libraryContent: some View {
        switch library.authorization {
        case .authorized, .limited:
            if isSearch && searchRequest.query.isEmpty {
                ContentUnavailableView("Search Photos", systemImage: "magnifyingglass", description: Text("Find photos by filename, capture date, album, or type such as Live Photo."))
            } else if let photos = visiblePhotos {
                if photos.count > 0 {
                    photoGrid(photos)
                } else if isSearch {
                    ContentUnavailableView.search(text: searchRequest.query)
                } else if library.authorization == .limited && album == nil {
                    accessMessage("No Photos Shared", description: "Manage Photos access to add photos to this library.")
                } else {
                    ContentUnavailableView("No Photos", systemImage: "photo.on.rectangle")
                }
            } else {
                ProgressView(isSearch ? "Searching Photos" : "Loading Photos")
            }
        case .notDetermined:
            ProgressView("Waiting for Photos Access")
        case .denied:
            accessMessage("Allow Photos Access", description: "Allow access in Settings to browse your photo library in Stylio.")
        case .restricted:
            ContentUnavailableView("Photos Access Restricted", systemImage: "lock", description: Text("Your device settings restrict access to Photos."))
        @unknown default:
            ContentUnavailableView("Photos Unavailable", systemImage: "photo.on.rectangle")
        }
    }

    private var sortMenu: some View {
        Menu {
            Picker("Sort By", selection: $sort) {
                Text("Date Captured").tag(LibrarySort.captured)
                Text("Date Modified").tag(LibrarySort.modified)
            }
            Picker("Order", selection: $ascending) {
                Label("Newest First", systemImage: "arrow.down").tag(false)
                Label("Oldest First", systemImage: "arrow.up").tag(true)
            }
            if album == nil && !selecting {
                Picker("View", selection: $timeline) {
                    ForEach(LibraryTimeline.allCases, id: \.self) { Text($0.title).tag($0) }
                }
            }
        } label: {
            Label("Sort and View Options", systemImage: "arrow.up.arrow.down")
        }
    }

    private var importMenu: some View {
        Menu {
            if album == nil { Button("Import from Files", systemImage: "folder") { isImportingFiles = true } }
            if library.authorization == .limited { Button("Manage Photos Access", systemImage: "lock", action: openAppSettings) }
        } label: {
            Label("Add Photos", systemImage: "plus")
        }
    }

    private func photoGrid(_ photos: PhotoAssets) -> some View {
        GeometryReader { geometry in
            ScrollViewReader { proxy in
                ScrollView {
                    if mode == .all {
                        let spacing: CGFloat = 2
                        let columns = max(3, Int(geometry.size.width / 120))
                        let side = max(1, (geometry.size.width - CGFloat(columns - 1) * spacing) / CGFloat(columns))
                        LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: spacing), count: columns), spacing: spacing) {
                            ForEach(0..<photos.count, id: \.self) { index in
                                photoTile(photos, index: index, side: side)
                            }
                        }
                    } else {
                        periodGrid(photos, width: geometry.size.width)
                    }
                }
                .task(id: scrollTarget) {
                    guard let scrollTarget else { return }
                    await Task.yield()
                    guard !Task.isCancelled else { return }
                    proxy.scrollTo(scrollTarget, anchor: detail == nil ? .top : nil)
                    self.scrollTarget = nil
                }
            }
        }
    }

    @ViewBuilder
    private func photoTile(_ photos: PhotoAssets, index: Int, side: CGFloat) -> some View {
        let asset = photos[index]
        Group {
            let tile = PhotoTile(asset: asset, size: CGSize(width: side, height: side), isSelected: selection.contains(asset.localIdentifier)) {
                if selecting {
                    toggle(asset)
                } else {
                    detailZoomID = asset.localIdentifier
                    detail = PhotoDetailSelection(photos: photos, index: index)
                }
            }
            if #available(iOS 18.0, *) {
                tile.matchedTransitionSource(id: asset.localIdentifier, in: photoTransition)
            } else {
                tile
            }
        }
        .id(ScrollTarget.photo(asset.localIdentifier))
    }

    @ViewBuilder
    private func photoDetail(_ selection: PhotoDetailSelection) -> some View {
        let viewer = PhotoDetailView(selection: selection) { id in
            detailZoomID = id
            scrollTarget = .photo(id)
        }
        if #available(iOS 18.0, *) {
            viewer.navigationTransition(.zoom(sourceID: detailZoomID ?? selection.id, in: photoTransition))
        } else {
            viewer
        }
    }

    private func periodGrid(_ photos: PhotoAssets, width: CGFloat) -> some View {
        let columns = max(2, Int(width / 230))
        let side = max(1, (width - 24 - CGFloat(columns - 1) * 8) / CGFloat(columns))
        return LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: 8), count: columns), spacing: 8) {
            ForEach(periods) { period in
                if period.index < photos.count {
                    let asset = photos[period.index]
                    Button {
                        if mode == .year {
                            scrollTarget = .period(LibraryTimeline.month.period(for: asset.creationDate))
                            timeline = .month
                        } else {
                            scrollTarget = .photo(asset.localIdentifier)
                            timeline = .all
                        }
                    } label: {
                        PhotoThumbnail(asset: asset, size: CGSize(width: side, height: side))
                            .overlay(alignment: .bottomLeading) {
                                periodTitle(period.date)
                                    .font(.headline)
                                    .foregroundStyle(.white)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(LinearGradient(colors: [.clear, .black.opacity(0.82)], startPoint: .top, endPoint: .bottom))
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .id(ScrollTarget.period(period.date))
                }
            }
        }
        .padding(12)
    }

    private func periodTitle(_ date: Date?) -> Text {
        guard let date else { return Text("Unknown Date") }
        return mode == .year ? Text(date, format: .dateTime.year()) : Text(date, format: .dateTime.month(.wide).year())
    }

    private var selectionBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !files.isEmpty {
                DisclosureGroup("Files (\(files.count))") {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(files, id: \.self) { Label($0.lastPathComponent, systemImage: "doc") }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 120)
                }
            }
            HStack {
                if selecting && selection.isEmpty { Text("Select photos") }
                else { Text("\(selection.count + files.count) selected") }
                Spacer()
                if isSearch && selecting && selection.isEmpty, let photos = visiblePhotos, photos.count > 0 {
                    Button("Select All") { selectAll(photos) }
                }
                if !selection.isEmpty || !files.isEmpty {
                    Button("Clear") { selection = []; files = [] }
                    Button("Process", action: processSelection)
                        .buttonStyle(.borderedProminent)
                        .disabled(processing.isBusy)
                }
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func refreshAssets(_ source: PHFetchResult<PHAsset>?) {
        guard let source else {
            assets = nil
            clearSelection()
            updatePeriods()
            return
        }
        let options = PhotoLibrary.photoOptions(sort: sort, ascending: ascending)
        if let album { assets = PHAsset.fetchAssets(in: album, options: options) }
        else if sort == .captured && !ascending { assets = source }
        else { assets = PHAsset.fetchAssets(with: .image, options: options) }
        if !selection.isEmpty {
            let available = library.selectedAssets(selection, sort: sort, ascending: ascending)
            selection = Set(available.map(\.localIdentifier))
        }
        updatePeriods()
    }

    private func updatePeriods() {
        guard mode != .all, let assets else { periods = []; return }
        let calendar = Calendar.current
        var seen = Set<Date?>()
        var found: [Period] = []
        for index in 0..<assets.count {
            let date = mode.period(for: assets.object(at: index).creationDate, calendar: calendar)
            if seen.insert(date).inserted { found.append(Period(date: date, index: index)) }
        }
        periods = found.sorted { left, right in
            guard let first = left.date else { return false }
            guard let second = right.date else { return true }
            return ascending ? first < second : first > second
        }
    }

    private func search(_ request: SearchRequest) async {
        guard !request.query.isEmpty, let assets else { return }
        do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
        let albums = library.myAlbums + library.smartAlbums
        let scan = Task.detached(priority: .userInitiated) {
            PhotoSearch.matches(query: request.query, in: assets, albums: albums)
        }
        let photos = await withTaskCancellationHandler { await scan.value } onCancel: { scan.cancel() }
        if !Task.isCancelled { matches = SearchResult(request: request, photos: photos) }
    }

    private func toggle(_ asset: PHAsset) {
        if selection.remove(asset.localIdentifier) == nil { selection.insert(asset.localIdentifier) }
    }

    private func toggleSelecting() {
        if selecting { clearSelection() }
        else { selecting = true }
    }

    private func clearSelection() {
        selection = []
        selecting = false
    }

    private func selectAll(_ photos: PhotoAssets) {
        selection = Set((0..<photos.count).map { photos[$0].localIdentifier })
    }

    private func accessMessage(_ title: LocalizedStringKey, description: LocalizedStringKey) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: "lock")
        } description: {
            Text(description)
        } actions: {
            Button("Open Settings", action: openAppSettings).buttonStyle(.borderedProminent)
        }
    }

    private func openAppSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }

    private func processSelection() {
        do {
            try processing.start(assets: library.selectedAssets(selection, sort: sort, ascending: ascending), files: files)
            clearSelection()
            files = []
            showsResults = true
        } catch let failure {
            error = failure.localizedDescription
        }
    }
}

private struct LibraryNavigationChrome: ViewModifier {
    let isSearch: Bool
    let selecting: Bool

    func body(content: Content) -> some View {
        if isSearch {
            content.navigationBarTitleDisplayMode(.inline)
        } else if #available(iOS 26.0, *) {
            content
                .toolbarTitleDisplayMode(selecting ? .inline : .inlineLarge)
                .toolbarBackground(.hidden, for: .navigationBar)
                .scrollEdgeEffectStyle(.soft, for: .top)
        } else {
            content.navigationBarTitleDisplayMode(selecting ? .inline : .automatic)
        }
    }
}

private struct PhotoTile: View {
    let asset: PHAsset
    let size: CGSize
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            PhotoThumbnail(asset: asset, size: size)
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
                .overlay { if isSelected { Rectangle().strokeBorder(Color.accentColor, lineWidth: 3) } }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(asset.mediaSubtypes.contains(.photoLive) ? Text("Live Photo") : Text("Photo"))
        .accessibilityValue(asset.creationDate.map { Text($0, style: .date) } ?? Text(""))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

struct PhotoThumbnail: View {
    let asset: PHAsset
    let size: CGSize
    var contentMode: PHImageContentMode = .aspectFill

    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?
    @State private var request: PHImageRequestID?
    @State private var token: UUID?

    private static let manager = PHCachingImageManager()
    private var pixelSize: CGSize { CGSize(width: ceil(size.width * displayScale), height: ceil(size.height * displayScale)) }

    var body: some View {
        ZStack {
            Rectangle().fill(contentMode == .aspectFit ? Color.black : Color(uiColor: .secondarySystemBackground))
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode == .aspectFit ? .fit : .fill)
            } else {
                Image(systemName: "photo").foregroundStyle(.secondary)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipped()
        .accessibilityHidden(true)
        .onAppear { load() }
        .onChange(of: pixelSize) { _, _ in if token != nil { load() } }
        .onChange(of: asset.localIdentifier) { _, _ in
            image = nil
            if token != nil { load() }
        }
        .onChange(of: asset.modificationDate) { _, _ in if token != nil { load() } }
        .onDisappear { cancel(); image = nil }
    }

    private func load() {
        cancel()
        guard pixelSize.width > 0, pixelSize.height > 0 else { return }
        let id = UUID()
        token = id
        let options = PHImageRequestOptions()
        options.deliveryMode = contentMode == .aspectFit ? .opportunistic : .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        request = Self.manager.requestImage(for: asset, targetSize: pixelSize, contentMode: contentMode, options: options) { image, _ in
            guard let image else { return }
            Task { @MainActor in if token == id { self.image = image } }
        }
    }

    private func cancel() {
        token = nil
        if let request { Self.manager.cancelImageRequest(request) }
        request = nil
    }
}
