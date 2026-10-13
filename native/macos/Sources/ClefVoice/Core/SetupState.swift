import Foundation

enum SetupState {
    static func completed(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: "clefVoice.setupCompleted")
    }

    static func complete(permissionsGranted: Bool, status: AppStatus, inventory: [String: Any], defaults: UserDefaults = .standard) -> Bool {
        let items = inventory["items"] as? [[String: Any]] ?? []
        guard permissionsGranted, status == .idle, inventory["busy"] as? Bool != true,
              items.contains(where: { $0["active"] as? Bool == true && $0["downloaded"] as? Bool == true && $0["status"] as? String == "downloaded" }) else { return false }
        defaults.set(true, forKey: "clefVoice.setupCompleted")
        return completed(defaults: defaults)
    }
}
