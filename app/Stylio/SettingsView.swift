import Foundation
import SwiftUI
import UIKit

enum AppAppearance: String, CaseIterable {
    case light, system, dark

    var title: LocalizedStringKey {
        switch self {
        case .light: "Light"
        case .system: "System"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .light: .light
        case .system: nil
        case .dark: .dark
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var processing: PhotoProcessing
    @AppStorage("stylio.appearance") private var appearance: AppAppearance = .system
    @AppStorage("stylio.keepScreenAwake") private var keepScreenAwake = false
    @AppStorage("stylio.resultPreview") private var resultPreview = true
    @State private var confirmReset = false
    @State private var feedback: String?
    @State private var buildLink: URL?
    @State private var showsFeedback = false

    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Appearance", selection: $appearance) {
                    ForEach(AppAppearance.allCases, id: \.self) { option in
                        Text(option.title).tag(option)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section {
                NavigationLink {
                    AISettingsView()
                } label: {
                    Label("AI Settings", systemImage: "sparkles")
                }
                Toggle("Keep Screen Awake", systemImage: "iphone", isOn: $keepScreenAwake)
                Toggle("Result Preview", systemImage: "photo", isOn: $resultPreview)
            } header: {
                Text("Processing")
            } footer: {
                Text("Processing preferences are saved on this device.")
            }

            Section("On this device") {
                Button { Task { await maintain(.update) } } label: {
                    deviceRow("Update Stylio", "Check for a newer app shell and refresh cached UI files.", icon: "arrow.clockwise")
                }
                Button { Task { await maintain(.clear) } } label: {
                    deviceRow("Clear cache", "Downloaded tools can be removed safely. Photos and preferences are kept.", icon: "externaldrive")
                }
                Button(role: .destructive) { confirmReset = true } label: {
                    deviceRow("Reset Stylio", "Remove history, preferences, downloaded AI models and cached app files.", icon: "trash")
                }
                if processing.isMaintaining { ProgressView() }
            }
            .disabled(processing.isBusy)

            Section {
                NavigationLink {
                    AboutView()
                } label: {
                    Label("About", systemImage: "info.circle")
                }
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog("Reset Stylio?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset Stylio", role: .destructive) { Task { await maintain(.reset) } }
        } message: {
            Text("This removes Stylio’s results, preferences, downloaded models, and cached files. Photos in your library are kept.")
        }
        .alert("Stylio", isPresented: $showsFeedback) {
            if let buildLink { Button("View iOS build") { UIApplication.shared.open(buildLink) } }
            Button("OK", role: .cancel) {}
        } message: {
            Text(feedback ?? "")
        }
    }

    private func deviceRow(_ title: LocalizedStringKey, _ description: LocalizedStringKey, icon: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                Text(description).font(.footnote).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: icon)
        }
    }

    private func maintain(_ action: NativeEngine.CacheAction) async {
        buildLink = nil
        do {
            try await processing.maintain(action)
            switch action {
            case .update:
                let check = await AppBuild.checkForUpdate()
                feedback = check.message
                buildLink = check.link
            case .clear: feedback = "Downloaded tools and cached files were cleared."
            case .reset: feedback = "Stylio has been reset."
            }
        } catch {
            feedback = error.localizedDescription
        }
        showsFeedback = true
    }
}

private enum AppBuild {
    static let source = URL(string: "https://github.com/WanThinnn/stylio")!
    static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—" }
    static var commit: String? { Bundle.main.infoDictionary?["StylioSourceCommit"] as? String }

    private struct WorkflowRuns: Decodable {
        struct Run: Decodable {
            let html_url: URL
            let display_title: String
        }
        let workflow_runs: [Run]
    }

    static func checkForUpdate() async -> (message: String, link: URL?) {
        do {
            let url = URL(string: "https://api.github.com/repos/WanThinnn/stylio/actions/workflows/ios-build.yml/runs?status=success&per_page=1")!
            let (data, response) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 10))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            guard let run = try JSONDecoder().decode(WorkflowRuns.self, from: data).workflow_runs.first else {
                return ("Cached files were refreshed. No successful iOS build was found.", nil)
            }
            // Dispatch runs use the workflow branch as head_sha. The run name carries the requested commit.
            if let commit, run.display_title.split(separator: " ").last == commit[...] {
                return ("Cached files were refreshed. This is the latest iOS build.", nil)
            }
            return ("Cached files were refreshed. The latest available iOS build is on GitHub Actions.", run.html_url)
        } catch {
            return ("Cached files were refreshed. Stylio couldn’t check for a newer build.", nil)
        }
    }
}

private struct AboutView: View {
    var body: some View {
        List {
            Section {
                VStack(spacing: 10) {
                    if let url = Bundle.main.url(forResource: "AboutIcon", withExtension: "png", subdirectory: "StylioEngine"),
                       let icon = UIImage(contentsOfFile: url.path) {
                        Image(uiImage: icon)
                            .resizable()
                            .frame(width: 96, height: 96)
                            .clipShape(RoundedRectangle(cornerRadius: 22))
                            .accessibilityHidden(true)
                    }
                    Text("Stylio").font(.title.bold())
                    Text("Photographic Styles for your iPhone photos")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Text("Version \(AppBuild.version)")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            Section {
                Text("Stylio is an independent, experimental app for editing photos. Keep your original photos.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Link(destination: AppBuild.source) {
                    Label("github.com/WanThinnn/stylio", systemImage: "chevron.left.forwardslash.chevron.right")
                }
            }
        }
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct AISettingsView: View {
    private enum Model: String, CaseIterable {
        case lite, standard, pro

        var title: LocalizedStringKey {
            switch self {
            case .lite: "Lite"
            case .standard: "Standard"
            case .pro: "Pro"
            }
        }
    }

    @AppStorage("stylio.ai.portrait") private var portrait = false
    @AppStorage("stylio.ai.detail") private var detail = false
    @AppStorage("stylio.ai.style") private var adaptiveStyles = false
    @AppStorage("stylio.ai.gpu") private var gpu = true
    @AppStorage("stylio.ai.model") private var model: Model = .standard

    var body: some View {
        Form {
            Section {
                Toggle("Smart Enhance", systemImage: "sparkles", isOn: smartEnhance)
            }

            Section("Effects") {
                effect(
                    "Lighting Depth Effect",
                    description: "Edit aperture and lighting in Photos. Keeps existing depth.",
                    icon: "viewfinder",
                    isOn: $portrait
                )
                effect(
                    "Sharpen Photo",
                    description: "Restore detail before Styles. Keeps HDR when supported.",
                    icon: "slider.horizontal.3",
                    isOn: $detail
                )
                effect(
                    "Adaptive Styles",
                    description: "Choose an editable starting Style for each photo.",
                    icon: "camera.filters",
                    isOn: $adaptiveStyles
                )
            }

            Section {
                effect(
                    "GPU Acceleration",
                    description: "Use the GPU for faster processing when available.",
                    icon: "cpu",
                    isOn: $gpu
                )
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) {
                        modelLabel.fixedSize(horizontal: true, vertical: false)
                        modelSlider.frame(minWidth: 124, idealWidth: 140, maxWidth: 180)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        modelLabel
                        modelSlider
                    }
                }
            } header: {
                Text("Processing Options")
            } footer: {
                Text("Your photos stay on your device.")
            }
        }
        .navigationTitle("AI Settings")
    }

    private var modelLabel: some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text("Model")
                Text("Lite is faster. Pro gives finer results.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 130, alignment: .leading)
            }
        } icon: {
            Image(systemName: "cube.transparent").foregroundStyle(Color.accentColor)
        }
    }

    private var modelSlider: some View {
        let tiers = Model.allCases
        let position = Binding<Double>(
            get: { Double(tiers.firstIndex(of: model) ?? 1) },
            set: { model = tiers[Int($0.rounded())] }
        )
        return VStack(spacing: 2) {
            Text(model.title)
                .font(.subheadline.weight(.medium))
                .accessibilityHidden(true)
            Slider(value: position, in: 0...Double(tiers.count - 1), step: 1)
                .accessibilityLabel("Model")
                .accessibilityValue(Text(model.title))
        }
    }

    private var smartEnhance: Binding<Bool> {
        Binding(
            get: { portrait || detail || adaptiveStyles },
            set: { enabled in
                portrait = enabled
                if !enabled {
                    detail = false
                    adaptiveStyles = false
                }
            }
        )
    }

    private func effect(
        _ title: LocalizedStringKey,
        description: LocalizedStringKey,
        icon: String,
        isOn: Binding<Bool>
    ) -> some View {
        Toggle(isOn: isOn) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                    Text(description)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: icon)
                    .foregroundStyle(Color.accentColor)
            }
        }
    }
}
