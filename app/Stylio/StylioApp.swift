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
    private enum Destination: Hashable {
        case library, albums, guide, settings
    }

    @AppStorage("stylio.appearance") private var appearance: AppAppearance = .system
    @StateObject private var library = PhotoLibrary()
    @StateObject private var processing = PhotoProcessing()
    @State private var destination: Destination = .library
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $destination) {
            NavigationStack {
                ProcessView()
            }
            .tabItem { Label("Library", systemImage: "photo.on.rectangle") }
            .tag(Destination.library)

            NavigationStack {
                AlbumsView()
            }
            .tabItem { Label("Albums", systemImage: "rectangle.stack") }
            .tag(Destination.albums)

            NavigationStack {
                GuideView()
            }
            .tabItem { Label("Guide", systemImage: "book") }
            .tag(Destination.guide)

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            .tag(Destination.settings)
        }
        .environmentObject(library)
        .environmentObject(processing)
        .preferredColorScheme(appearance.colorScheme)
        .task { await library.requestAccessIfNeeded() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { library.refresh() }
        }
        .onChange(of: processing.resetCount) { _, _ in library.clearSelection() }
    }
}
