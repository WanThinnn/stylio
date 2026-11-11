import ImageIO
import SwiftUI
import UIKit

struct ProcessingResultsButton: View {
    @EnvironmentObject private var processing: PhotoProcessing
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: processing.isProcessing ? "tray.and.arrow.down" : "tray")
                .overlay(alignment: .topTrailing) {
                    if processing.hasResultErrors {
                        Circle().fill(Color.red).frame(width: 7, height: 7).offset(x: 4, y: -3)
                    }
                }
        }
        .accessibilityLabel("Processing Results")
        .accessibilityValue(processing.isProcessing ? Text("Processing") : processing.hasResultErrors ? Text("Contains errors") : Text(""))
    }
}

struct ProcessingResultsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var processing: PhotoProcessing
    @AppStorage("stylio.resultPreview") private var resultPreview = true

    var body: some View {
        NavigationStack {
            List(processing.jobs) { job in
                VStack(alignment: .leading, spacing: 8) {
                    Text(job.name).font(.headline)
                    Text(job.message)
                        .font(.subheadline)
                        .foregroundStyle(job.failed || job.saveError != nil ? Color.red : Color.secondary)
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
                            if job.saveError != nil {
                                Button("Retry Save") {
                                    Task { await processing.retrySaving(job.id) }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(processing.isBusy)
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
        .presentationDetents([.medium, .large])
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
