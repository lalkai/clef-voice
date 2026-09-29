import Foundation
import os

public enum AppStatus: String {
    case idle
    case loading
    case downloading
    case recording
    case transcribing
    case error
}

public enum DictationEvent {
    case statusChanged(AppStatus, String)
    case finalTranscription(String, Double)
    case audioLevelUpdated(Float)
    case modelProgress(model: String, progress: Double, downloading: Bool)
    case history([Any])
    case stats([String: Any])
    case config([String: Any])
}

public struct TranscriptionEntry: Identifiable, Equatable {
    public let id: String
    public let text: String
    public let timestamp: Date
    public let language: String
    public let wpm: Double

    public init(id: String = UUID().uuidString, text: String, timestamp: Date = Date(), language: String, wpm: Double) {
        self.id = id
        self.text = text
        self.timestamp = timestamp
        self.language = language
        self.wpm = wpm
    }

    public static func == (lhs: TranscriptionEntry, rhs: TranscriptionEntry) -> Bool { lhs.id == rhs.id }

    static func parseTimestamp(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    public var timeString: String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f.string(from: timestamp)
    }
}

public enum Log {
    public static let app = Logger(subsystem: AppConfig.bundleIdentifier, category: "app")
    public static let session = Logger(subsystem: AppConfig.bundleIdentifier, category: "session")
    public static let whisper = Logger(subsystem: AppConfig.bundleIdentifier, category: "whisper")
    public static let model = Logger(subsystem: AppConfig.bundleIdentifier, category: "model")
    public static let audio = Logger(subsystem: AppConfig.bundleIdentifier, category: "audio")
    public static let hotkey = Logger(subsystem: AppConfig.bundleIdentifier, category: "hotkey")
    public static let text = Logger(subsystem: AppConfig.bundleIdentifier, category: "text")
    public static let engine = Logger(subsystem: AppConfig.bundleIdentifier, category: "engine")
}