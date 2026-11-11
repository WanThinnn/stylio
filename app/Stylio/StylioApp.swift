import SwiftUI
import UIKit

@main
struct StylioApp: App {
    var body: some Scene {
        WindowGroup { StylioTabs() }
    }
}

private struct StylioTabs: View {
    private enum Destination: Hashable {
        case library, albums, guide, settings, search
    }

    @AppStorage("stylio.appearance") private var appearance: AppAppearance = .system
    @StateObject private var library = PhotoLibrary()
    @StateObject private var processing = PhotoProcessing()
    @State private var destination: Destination = .library
    @State private var timeline = LibraryTimeline.all
    @State private var showsLibraryTimeline = false
    @State private var searchText = ""
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        tabs
            .environmentObject(library)
            .environmentObject(processing)
            .preferredColorScheme(appearance.colorScheme)
            .task { await library.requestAccessIfNeeded() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { library.refresh() }
            }
            .onChange(of: processing.resetCount) { _, _ in
                timeline = .all
                showsLibraryTimeline = false
                searchText = ""
            }
            .onChange(of: destination) { _, _ in showsLibraryTimeline = false }
    }

    @ViewBuilder private var tabs: some View {
        if #available(iOS 26.0, *) {
            glassTabs
        } else {
            legacyTabs
        }
    }

    @available(iOS 26.0, *)
    @ViewBuilder private var glassTabs: some View {
        let showTimeline = destination == .library && showsLibraryTimeline
            && UIDevice.current.userInterfaceIdiom == .phone && (library.assets?.count ?? 0) > 0
        let tabs = TabView(selection: $destination) {
            Tab("Library", systemImage: "photo.on.rectangle", value: Destination.library) { libraryTab }
            Tab("Albums", systemImage: "rectangle.stack", value: Destination.albums) { albumsTab }
            Tab("Guide", systemImage: "book", value: Destination.guide) { guideTab }
            Tab("Settings", systemImage: "gearshape", value: Destination.settings) { settingsTab }
            Tab(value: Destination.search, role: .search) { searchTab }
        }
        .searchable(text: $searchText, prompt: "Photos, dates, and albums")
        .tabViewSearchActivation(.searchTabSelection)
        .tabBarMinimizeBehavior(.onScrollDown)

        if #available(iOS 26.1, *) {
            tabs.tabViewBottomAccessory(isEnabled: showTimeline) {
                LibraryTimelineAccessory(timeline: $timeline, isRequested: $showsLibraryTimeline)
            }
        } else {
            tabs.tabViewBottomAccessory {
                if showTimeline { LibraryTimelineAccessory(timeline: $timeline, isRequested: $showsLibraryTimeline) }
            }
        }
    }

    private var legacyTabs: some View {
        TabView(selection: $destination) {
            libraryTab.tabItem { Label("Library", systemImage: "photo.on.rectangle") }.tag(Destination.library)
            albumsTab.tabItem { Label("Albums", systemImage: "rectangle.stack") }.tag(Destination.albums)
            guideTab.tabItem { Label("Guide", systemImage: "book") }.tag(Destination.guide)
            settingsTab.tabItem { Label("Settings", systemImage: "gearshape") }.tag(Destination.settings)
            NavigationStack {
                ProcessView(searchText: $searchText)
                    .searchable(text: $searchText, prompt: "Photos, dates, and albums")
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }
            .tag(Destination.search)
        }
    }

    private var libraryTab: some View {
        NavigationStack { ProcessView(timeline: $timeline, timelineVisibility: $showsLibraryTimeline) }
    }
    private var albumsTab: some View { NavigationStack { AlbumsView() } }
    private var guideTab: some View { NavigationStack { GuideView() } }
    private var settingsTab: some View { NavigationStack { SettingsView() } }
    private var searchTab: some View { NavigationStack { ProcessView(searchText: $searchText) } }
}

@available(iOS 26.0, *)
private struct LibraryTimelineAccessory: View {
    @Binding var timeline: LibraryTimeline
    @Binding var isRequested: Bool
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var selectionHighlight

    var body: some View {
        Group {
            if placement == .inline {
                HStack(spacing: 0) {
                    ForEach(LibraryTimeline.allCases, id: \.self) { option in
                        Button {
                            withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) { timeline = option }
                        } label: {
                            Text(option.title)
                                .font(.subheadline.weight(.medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                                .frame(maxWidth: .infinity, minHeight: 40)
                                .background {
                                    if timeline == option {
                                        Capsule().fill(Color.primary.opacity(0.14))
                                            .matchedGeometryEffect(id: "selection", in: selectionHighlight)
                                    }
                                }
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(timeline == option ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 4)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Library Timeline")
            } else {
                Color.clear.frame(height: 0).accessibilityHidden(true)
            }
        }
        .onChange(of: placement) { previous, current in
            if previous == .inline && current != .inline { isRequested = false }
        }
    }
}

extension View {
    @ViewBuilder
    func stylioGlass<S: Shape>(in shape: S) -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else {
            background(.regularMaterial, in: shape)
        }
    }
}
