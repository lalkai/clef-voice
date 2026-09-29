// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.
public enum WhisperModelSize: String, CaseIterable, Identifiable, Codable {
    case `tiny` = "tiny"
    case `base` = "base"
    case `small` = "small"
    case `largeV3Turbo` = "large-v3-turbo"

    public var id: String { rawValue }

    public var displayName: String { AppConfig.modelLabels[rawValue] ?? rawValue }
}
