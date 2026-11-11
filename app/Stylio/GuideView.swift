import SwiftUI

struct GuideView: View {
    var body: some View {
        List {
            Section {
                topic("How to Use", icon: "photo.on.rectangle") {
                    Text("Allow Photos access, then select photos in Library or Albums. Tap Process and use Save to Photos in the results.")
                    Text("Use Library Options to import images or an original HEIC and MOV from Files.")
                }
                topic("Formats and Processing", icon: "square.stack") {
                    Text("A Live Photo contains a still image and a paired video. Keep the matching HEIC and MOV together when using Files.")
                    Text("Stylio shows Save Live Photo when the processed image can use the original motion.")
                    Text("Adjust AI effects and model preferences in Settings → AI Settings.")
                }
                topic("Edited Styles or Portrait", icon: "slider.horizontal.3") {
                    Text("Keep the original HEIC. A copy exported after editing in Photos can lose Styles, HDR or depth data.")
                }
                topic("Troubleshooting", icon: "questionmark.circle") {
                    Text("If only some photos appear, review Stylio’s Photos access in iOS Settings. Full access makes the entire photo library visible in Stylio.")
                }
            }
        }
        .navigationTitle("Guide")
    }

    private func topic<Content: View>(
        _ title: LocalizedStringKey,
        icon: String,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8, content: content)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.vertical, 8)
        } label: {
            Label(title, systemImage: icon)
        }
    }
}
