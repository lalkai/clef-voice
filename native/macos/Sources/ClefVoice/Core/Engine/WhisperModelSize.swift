import Foundation

/// Whisper model sizes. Data-only; model download/loading is handled by the Go core.
public enum WhisperModelSize: String, CaseIterable, Identifiable, Codable {
    case tiny = "tiny"
    case base = "base"
    case small = "small"
    case largeTurbo = "large-v3-turbo"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .tiny: "Tiny (~75 MB - Fast)"
        case .base: "Base (~142 MB - Balanced)"
        case .small: "Small (~466 MB - Accurate)"
        case .largeTurbo: "Large V3 Turbo (~1.5 GB - Best)"
        }
    }
}
