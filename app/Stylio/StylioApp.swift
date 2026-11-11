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
        case process, history, guide, settings
    }

    @AppStorage("stylio.appearance") private var appearance: AppAppearance = .system
    @State private var destination: Destination = .process

    var body: some View {
        TabView(selection: $destination) {
            NavigationStack {
                ProcessView()
            }
            .tabItem { Label("Process", systemImage: "photo") }
            .tag(Destination.process)

            NavigationStack {
                ContentUnavailableView {
                    Label("No processed photos", systemImage: "clock")
                } description: {
                    Text("Your processed photos will appear here.")
                } actions: {
                    Button("Open Library") { destination = .process }
                        .buttonStyle(.borderedProminent)
                }
                .navigationTitle("History")
            }
            .tabItem { Label("History", systemImage: "clock") }
            .tag(Destination.history)

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
        .preferredColorScheme(appearance.colorScheme)
    }
}
