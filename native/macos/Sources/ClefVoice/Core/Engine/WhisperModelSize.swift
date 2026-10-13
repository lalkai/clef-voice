// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.
public enum WhisperModelSize: String, CaseIterable, Identifiable, Codable {
    case `tiny` = "tiny"
    case `base` = "base"
    case `small` = "small"
    case `medium` = "medium"
    case `largeV3Turbo` = "large-v3-turbo"
    case `largeV3` = "large-v3"
    case `tinyEn` = "tiny-en"
    case `baseEn` = "base-en"
    case `smallEn` = "small-en"
    case `mediumEn` = "medium-en"
    case `breezeAsr` = "breeze-asr"
    case `largeV1` = "large-v1"
    case `largeV2` = "large-v2"

    public var id: String { rawValue }

    public var displayName: String { AppConfig.modelLabels[rawValue] ?? rawValue }
}
