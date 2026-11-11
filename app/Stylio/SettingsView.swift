import Foundation
import SwiftUI

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
    @AppStorage("stylio.appearance") private var appearance: AppAppearance = .system
    @AppStorage("stylio.keepScreenAwake") private var keepScreenAwake = false
    @AppStorage("stylio.resultPreview") private var resultPreview = true

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

            Section("About") {
                LabeledContent("App Version", value: appVersion)
                if let sourceURL = URL(string: "https://github.com/WanThinnn/stylio") {
                    Link(destination: sourceURL) {
                        Label("Source Code", systemImage: "chevron.left.forwardslash.chevron.right")
                    }
                }
            }
        }
        .navigationTitle("Settings")
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
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
                VStack(alignment: .leading, spacing: 8) {
                    Text("Model")
                    Picker("Model", selection: $model) {
                        ForEach(Model.allCases, id: \.self) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            } header: {
                Text("Processing Options")
            } footer: {
                Text("Lite is faster. Pro uses larger models. Your photos stay on your device.")
            }
        }
        .navigationTitle("AI Settings")
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
