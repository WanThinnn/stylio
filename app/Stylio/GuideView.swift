import SwiftUI

struct GuideView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                GuideCard("How to use", summary: "Process a photo, then fine-tune it in Photos.", icon: "photo", tint: .blue) {
                    Text("Open a photo in Library or Albums and tap Add Styles. To process several photos together, tap Select, choose photos, and tap Process.")
                    Text("Stylio saves the result to Photos automatically. Open it in Photos → Edit to adjust Styles. Texture and Grain require iOS 27.")
                    Text("In Shortcuts, add Process Photos with Stylio to a shortcut that receives Images from the Share Sheet. Set its Photos input to Shortcut Input. Then run it directly from Photos → Share.")
                }
                GuideCard("Formats and processing", summary: "Supported formats, HDR, Live Photo and originals.", icon: "square.3.layers.3d", tint: .purple) {
                    Text("Stylio supports HEIC, JPG, PNG, DNG, WebP, GIF, BMP and AVIF. It develops DNG to sRGB HEIC and uses one frame from animated images.")
                    Text("Use the original HEIC to preserve HDR, Styles and Portrait data. When importing a Live Photo from Files, select its HEIC and matching MOV together. Stylio keeps the motion when the processed pair is compatible.")
                }
                GuideCard("iPhone 16/17 photos with edited Styles or Portrait", summary: "What Stylio can preserve and what Photos may omit.", icon: "person.crop.rectangle", tint: .orange) {
                    Text("Editing Styles or Portrait in Photos can change what an exported copy contains. Stylio can keep editing data that remains in the file. An original HEIC gives it the most information to work with.")
                    Text("Portrait controls depend on the depth and camera data in the file. Keep the original and check the result in Photos → Edit.")
                }
                GuideCard("Troubleshooting", summary: "First-run downloads, large photos and capture dates.", icon: "wrench", tint: .green) {
                    Text("The first conversion may download processing tools or AI models for reuse. Try one large photo at a time.")
                    Text("Stylio keeps capture metadata and uses the library capture date when saving a photo from Photos. If some photos are missing from Library, check Stylio’s Photos access in iOS Settings.")
                }
                Label {
                    Text("Stylio is an independent, open-source app.")
                        .frame(maxWidth: .infinity, alignment: .leading)
                } icon: {
                    Image(systemName: "info.circle")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            }
            .frame(maxWidth: 660)
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Guide")
    }
}

private struct GuideCard<Content: View>: View {
    let title: LocalizedStringKey
    let summary: LocalizedStringKey
    let icon: String
    let tint: Color
    let content: () -> Content

    init(_ title: LocalizedStringKey, summary: LocalizedStringKey, icon: String, tint: Color, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.summary = summary
        self.icon = icon
        self.tint = tint
        self.content = content
    }

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 12) {
                Divider()
                content()
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 12)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(tint)
                    .frame(width: 38, height: 38)
                    .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 11))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.subheadline.weight(.bold)).foregroundStyle(.primary)
                    Text(summary).font(.footnote).foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 11)
            .frame(minHeight: 76)
            .contentShape(Rectangle())
        }
        .tint(.secondary)
        .padding(.horizontal, 16)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 25))
    }
}
