import Foundation
import UserNotifications

@MainActor
enum ProcessingNotifications {
    static func post(_ result: PhotoProcessing.BatchResult) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

        let content = UNMutableNotificationContent()
        var details: [String] = []
        if result.savedCount == 0 {
            content.title = String(localized: "Couldn’t Save Photos")
        } else {
            content.title = String(localized: "Processing Complete")
            if result.liveCount == result.savedCount {
                details.append(result.savedCount == 1
                    ? String(localized: "1 Live Photo saved to Photos.")
                    : String(localized: "\(result.savedCount) Live Photos saved to Photos."))
            } else {
                details.append(result.savedCount == 1
                    ? String(localized: "1 processed photo saved to Photos.")
                    : String(localized: "\(result.savedCount) processed photos saved to Photos."))
            }
        }

        if !result.failures.isEmpty {
            details.append(String(localized: "Open Stylio to check incomplete results."))
        }
        if result.lostMotionCount > 0 {
            details.append(result.lostMotionCount == 1
                ? String(localized: "A Live Photo was saved as a still.")
                : String(localized: "\(result.lostMotionCount) Live Photos were saved as stills."))
        }
        if result.depthWarningCount > 0 {
            details.append(result.depthWarningCount == 1
                ? String(localized: "Lighting Depth could not be added to one photo.")
                : String(localized: "Lighting Depth could not be added to \(result.depthWarningCount) photos."))
        }
        content.body = details.joined(separator: " ")
        try? await center.add(UNNotificationRequest(identifier: "stylio.processing.finished", content: content, trigger: nil))
    }
}
