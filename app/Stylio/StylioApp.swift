import SwiftUI

@main
struct StylioApp: App {
    var body: some Scene {
        WindowGroup {
            StylioTabs()
        }
    }
}

private struct StylioTabs: View {
    private enum Destination: CaseIterable, Hashable {
        case library, albums, guide, settings

        var title: LocalizedStringKey {
            switch self {
            case .library: "Library"
            case .albums: "Albums"
            case .guide: "Guide"
            case .settings: "Settings"
            }
        }

        var icon: String {
            switch self {
            case .library: "photo.on.rectangle"
            case .albums: "rectangle.stack"
            case .guide: "book"
            case .settings: "gearshape"
            }
        }
    }

    @AppStorage("stylio.appearance") private var appearance: AppAppearance = .system
    @StateObject private var library = PhotoLibrary()
    @StateObject private var processing = PhotoProcessing()
    @State private var destination: Destination = .library
    @State private var timeline = LibraryTimeline.all
    @State private var compactDock = false
    @State private var showsSearch = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $destination) {
            NavigationStack {
                ProcessView(timeline: $timeline, compactDock: $compactDock)
                    .toolbar(.hidden, for: .tabBar)
            }
            .tabItem { Label("Library", systemImage: "photo.on.rectangle") }
            .tag(Destination.library)

            NavigationStack {
                AlbumsView().toolbar(.hidden, for: .tabBar)
            }
            .tabItem { Label("Albums", systemImage: "rectangle.stack") }
            .tag(Destination.albums)

            NavigationStack {
                GuideView().toolbar(.hidden, for: .tabBar)
            }
            .tabItem { Label("Guide", systemImage: "book") }
            .tag(Destination.guide)

            NavigationStack {
                SettingsView().toolbar(.hidden, for: .tabBar)
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            .tag(Destination.settings)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { dock }
        .sheet(isPresented: $showsSearch) {
            NavigationStack { ProcessView(isSearch: true) }
        }
        .environmentObject(library)
        .environmentObject(processing)
        .preferredColorScheme(appearance.colorScheme)
        .task { await library.requestAccessIfNeeded() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { library.refresh() }
        }
        .onChange(of: processing.resetCount) { _, _ in timeline = .all; compactDock = false }
    }

    private var dock: some View {
        HStack(spacing: 8) {
            Button { showsSearch = true } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 21, weight: .semibold))
                    .frame(width: 52, height: 52)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .stylioGlass(in: Circle())
            .accessibilityLabel("Search Photos")

            if destination == .library && (compactDock || timeline != .all) {
                Picker("Library Timeline", selection: $timeline) {
                    ForEach(LibraryTimeline.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(6)
                .frame(minHeight: 52)
                .stylioGlass(in: Capsule())

                Menu {
                    Button("Expand Tabs", systemImage: "arrow.left.and.right") {
                        timeline = .all
                        compactDock = false
                    }
                    ForEach(Destination.allCases.filter { $0 != .library }, id: \.self) { tab in
                        Button { destination = tab } label: { Label(tab.title, systemImage: tab.icon) }
                    }
                } label: {
                    Image(systemName: Destination.library.icon)
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 52, height: 52)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .stylioGlass(in: Circle())
                .accessibilityLabel("Library and Tabs")
            } else {
                HStack(spacing: 0) {
                    ForEach(Destination.allCases, id: \.self) { tab in
                        Button { destination = tab } label: {
                            VStack(spacing: 3) {
                                Image(systemName: tab.icon).font(.system(size: 18, weight: .medium))
                                Text(tab.title).font(.caption2.weight(.medium)).lineLimit(1).minimumScaleFactor(0.72)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .foregroundStyle(destination == tab ? Color.accentColor : Color.primary)
                            .background(destination == tab ? Color.primary.opacity(0.08) : Color.clear, in: Capsule())
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(destination == tab ? .isSelected : [])
                    }
                }
                .padding(4)
                .stylioGlass(in: Capsule())
            }
        }
        .frame(maxWidth: 460)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 3)
        .frame(maxWidth: .infinity)
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
