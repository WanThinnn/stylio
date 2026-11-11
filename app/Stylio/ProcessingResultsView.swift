import ImageIO
import SwiftUI
import UIKit

struct ProcessingResultsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var processing: PhotoProcessing
    @AppStorage("stylio.resultPreview") private var resultPreview = true

    var body: some View {
        NavigationStack {
            List(processing.jobs) { job in
                VStack(alignment: .leading, spacing: 8) {
                    Text(job.name).font(.headline)
                    Text(job.saved ? "Saved to Photos" : job.message)
                        .font(.subheadline)
                        .foregroundStyle(job.failed ? Color.red : Color.secondary)
                    if let progress = job.progress {
                        ProgressView(value: progress, total: 100)
                            .accessibilityLabel("Processing photo")
                    }
                    if let output = job.result {
                        if resultPreview { ResultThumbnail(url: output.photo) }
                        ForEach(Array(output.notes.enumerated()), id: \.offset) { _, note in
                            Text(note).font(.footnote).foregroundStyle(.secondary)
                        }
                        if let error = job.saveError {
                            Text(error).font(.footnote).foregroundStyle(.red)
                        }
                        HStack {
                            if !job.saved {
                                Button(output.movie == nil ? "Save to Photos" : "Save Live Photo") {
                                    Task { await processing.save(job.id) }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(job.saving)
                            }
                            ShareLink(items: [output.photo] + (output.movie.map { [$0] } ?? []))
                                .buttonStyle(.bordered)
                            if job.saving { ProgressView() }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Processing Results")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

private struct ResultThumbnail: View {
    let url: URL
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel("Processed photo")
            }
        }
        .task(id: url) {
            image = await Task.detached(priority: .utility) {
                guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                      let image = CGImageSourceCreateThumbnailAtIndex(source, CGImageSourceGetPrimaryImageIndex(source), [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 640,
                      ] as CFDictionary) else { return nil as UIImage? }
                return UIImage(cgImage: image)
            }.value
        }
    }
}
