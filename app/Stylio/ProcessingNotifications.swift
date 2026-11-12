import Foundation
import UserNotifications

@MainActor
enum ProcessingNotifications {
    static func post(_ result: PhotoProcessing.BatchResult) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

        let content = UNMutableNotificationContent()
        if result.savedCount == 0 {
            content.title = String(localized: "Couldn’t Save Photos")
        } else if result.liveCount == result.savedCount {
            content.title = result.savedCount == 1
                ? String(localized: "Live Photo Saved")
                : String(localized: "\(result.savedCount) Live Photos Saved")
        } else {
            content.title = result.savedCount == 1
                ? String(localized: "Saved to Photos")
                : String(localized: "Saved \(result.savedCount) Photos")
        }

        var details: [String] = []
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
