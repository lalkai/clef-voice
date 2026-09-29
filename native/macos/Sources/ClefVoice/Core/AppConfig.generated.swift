// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.
enum AppConfig {
    static let version = "0.4.0"
    static let name = "ClefVoice"
    static let bundleIdentifier = "com.clefvoice.app"
    static let defaultModel: WhisperModelSize = .`base`
    static let defaultVadThreshold: Double = 0.012
    static let modelLabels: [String: String] = [
        "tiny": "Tiny (~75 MB - Fast)",
        "base": "Base (~142 MB - Balanced)",
        "small": "Small (~466 MB - Accurate)",
        "large-v3-turbo": "Large V3 Turbo (~1.5 GB - Best)",
    ]
}
