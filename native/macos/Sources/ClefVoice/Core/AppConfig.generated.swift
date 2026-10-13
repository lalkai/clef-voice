// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.
enum AppConfig {
    static let version = "0.4.1"
    static let name = "ClefVoice"
    static let defaultHotkey = "Fn"
    static let defaultVADEnabled = true
    static let defaultAutoStopEnabled = false
    static let defaultAutoStopSeconds = 0.9
    static let defaultRemoveFiller = true
    static let defaultAutoCapitalize = true
    static let defaultCustomVocabulary = ["ClefVoice", "TypeScript", "TailwindCSS"] as [String]
    static let bundleIdentifier = "com.clefvoice.app"
    static let defaultModel: WhisperModelSize = .`base`
    static let defaultVadThreshold: Double = 0.012
    static let commandBytes = 1000000
    static let modelLabels: [String: String] = [
        "tiny": "Whisper Tiny (~78 MB)",
        "base": "Whisper Base (~148 MB)",
        "small": "Whisper Small (~488 MB)",
        "medium": "Whisper Medium (~492 MB)",
        "large-v3-turbo": "Whisper Large V3 Turbo (~1.62 GB)",
        "large-v3": "Whisper Large V3 (~1.08 GB)",
        "tiny-en": "Whisper Tiny (English) (~78 MB)",
        "base-en": "Whisper Base (English) (~148 MB)",
        "small-en": "Whisper Small (English) (~488 MB)",
        "medium-en": "Whisper Medium (English) (~1.53 GB)",
        "breeze-asr": "Breeze ASR 25 (~1.08 GB)",
        "large-v1": "Whisper Large V1 (~3.09 GB)",
        "large-v2": "Whisper Large V2 (~3.09 GB)",
    ]
}
