import Foundation

// A wire-name adapter only. Defaults, validation and persistence belong to Go.
enum SettingsPresentation {
    private static let fields = [
        "languages": "selectedLanguages", "model": "modelSize", "hotkey": "hotkey",
        "vad_enabled": "vadEnabled", "vad_threshold": "vadThreshold",
        "auto_stop_enabled": "autoStopEnabled", "auto_stop_seconds": "autoStopSeconds",
        "remove_filler_words": "removeFillerWords", "auto_capitalize": "autoCapitalize",
        "custom_vocabulary": "customVocabulary",
    ]

    static func enginePatch(_ settings: [String: Any]) -> [String: Any] {
        var patch: [String: Any] = [:]
        for (source, destination) in fields {
            if let value = settings[destination] { patch[source] = value }
        }
        return patch
    }

    static func webJSON(_ config: [String: Any]) throws -> [String: Any] {
        var settings: [String: Any] = [:]
        for (source, destination) in fields {
            guard let value = config[source] else { throw EngineFailure("Incomplete engine settings: \(source)") }
            settings[destination] = value
        }
        if let raw = config["hotkey"] as? String, let hotkey = HotkeyType(persistedValue: raw) {
            settings["hotkeyLabel"] = hotkey.displayName
        }
        return settings
    }
}
