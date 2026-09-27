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
    public static let app = Logger(subsystem: "com.clefvoice.app", category: "app")
    public static let session = Logger(subsystem: "com.clefvoice.app", category: "session")
    public static let whisper = Logger(subsystem: "com.clefvoice.app", category: "whisper")
    public static let model = Logger(subsystem: "com.clefvoice.app", category: "model")
    public static let audio = Logger(subsystem: "com.clefvoice.app", category: "audio")
    public static let hotkey = Logger(subsystem: "com.clefvoice.app", category: "hotkey")
    public static let text = Logger(subsystem: "com.clefvoice.app", category: "text")
    public static let engine = Logger(subsystem: "com.clefvoice.app", category: "engine")
}