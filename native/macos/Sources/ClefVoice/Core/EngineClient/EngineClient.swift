import Foundation

/// Events emitted by the Go core engine (`clefd`) over stdio.
enum EngineEvent {
    case ready(version: String)
    case status(AppStatus, String)
    case level(Float)
    case transcribed(text: String, wpm: Double, language: String, samples: Int)
    case modelProgress(model: String, progress: Double, downloading: Bool)
    case modelLoaded(model: String)
    case history([Any])
    case stats([String: Any])
    case config([String: Any])
    case error(String)
}

extension EngineEvent {
    init?(json: [String: Any]) {
        guard let type = json["type"] as? String else { return nil }
        switch type {
        case "ready":
            self = .ready(version: json["version"] as? String ?? "")
        case "status":
            let raw = json["status"] as? String ?? "idle"
            self = .status(AppStatus(rawValue: raw) ?? .idle, json["message"] as? String ?? "")
        case "level":
            self = .level((json["level"] as? NSNumber)?.floatValue ?? 0)
        case "transcribed":
            self = .transcribed(
                text: json["text"] as? String ?? "",
                wpm: (json["wpm"] as? NSNumber)?.doubleValue ?? 0,
                language: json["language"] as? String ?? "",
                samples: (json["samples"] as? NSNumber)?.intValue ?? 0
            )
        case "model_progress":
            self = .modelProgress(
                model: json["model"] as? String ?? "",
                progress: (json["progress"] as? NSNumber)?.doubleValue ?? 0,
                downloading: json["downloading"] as? Bool ?? false
            )
        case "model_loaded":
            self = .modelLoaded(model: json["model"] as? String ?? "")
        case "history":
            self = .history(json["items"] as? [Any] ?? [])
        case "stats":
            self = .stats(json["stats"] as? [String: Any] ?? [:])
        case "config":
            self = .config(json["config"] as? [String: Any] ?? [:])
        case "error":
            self = .error(json["message"] as? String ?? "Unknown error")
        default:
            return nil
        }
    }
}

/// Spawns and manages the `clefd` process, speaking its line-delimited JSON protocol.
protocol DictationEngine: AnyObject {
    var onEvent: ((EngineEvent) -> Void)? { get set }
    func launch()
    func terminate()
    func send(_ command: [String: Any])
}

public final class EngineClient: DictationEngine {

    var onEvent: ((EngineEvent) -> Void)?

    private var process: Process?
    private var inputHandle: FileHandle?
    private let writeLock = NSLock()

    public init() {}

    func launch() {
        guard process?.isRunning != true else { return }
        guard let path = locateEngine() else {
            Log.engine.error("clefd binary not found in bundle")
            onEvent?(.error("Engine binary not found."))
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: path)
        proc.arguments = []

        let outPipe = Pipe()
        let errPipe = Pipe()
        let inPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = errPipe
        proc.standardInput = inPipe

        self.inputHandle = inPipe.fileHandleForWriting
        self.process = proc

        // Drain stderr to the console so whisper.cpp logs are visible in dev builds.
        errPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty { return }
            if let text = String(data: data, encoding: .utf8) {
                FileHandle.standardError.write(text.data(using: .utf8) ?? Data())
            }
        }

        proc.terminationHandler = { [weak self] terminated in
            DispatchQueue.main.async {
                guard self?.process === terminated else { return }
                self?.inputHandle = nil
                self?.process = nil
                self?.onEvent?(.error("Engine process terminated unexpectedly."))
            }
        }

        do {
            try proc.run()
        } catch {
            Log.engine.error("failed to launch engine: \(error.localizedDescription)")
            inputHandle = nil
            process = nil
            onEvent?(.error("Failed to launch engine: \(error.localizedDescription)"))
            return
        }

        readLines(from: outPipe.fileHandleForReading, process: proc)
    }

    func send(_ dict: [String: Any]) {
        guard let handle = inputHandle else {
            // Auto-restart if dead
            Log.engine.info("Engine was dead. Relaunching...")
            launch()
            guard let newHandle = inputHandle else { return }
            _sendBytes(dict, to: newHandle)
            return
        }
        _sendBytes(dict, to: handle)
    }

    private func _sendBytes(_ dict: [String: Any], to handle: FileHandle) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let line = String(data: data, encoding: .utf8),
              let bytes = (line + "\n").data(using: .utf8) else { return }

        writeLock.lock()
        defer { writeLock.unlock() }
        do {
            if #available(macOS 10.15.4, *) {
                try handle.write(contentsOf: bytes)
            } else {
                handle.write(bytes)
            }
        } catch {
            Log.engine.error("Failed to write to engine: \(error)")
        }
    }

    func terminate() {
        process?.terminate()
        process = nil
        inputHandle = nil
    }

    // MARK: - Helpers

    private func locateEngine() -> String? {
        let fm = FileManager.default
        if let overridePath = ProcessInfo.processInfo.environment["CLEF_ENGINE"],
           fm.fileExists(atPath: overridePath) {
            return overridePath
        }
        let candidates = [
            Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/clefd"),
            Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/clefd"),
        ]
        for url in candidates where fm.fileExists(atPath: url.path) {
            return url.path
        }
        return nil
    }

    private func readLines(from handle: FileHandle, process: Process) {
        DispatchQueue.global(qos: .userInitiated).async {
            var buffer = Data()
            while true {
                let data = handle.availableData
                if data.isEmpty { break }
                buffer.append(data)
                // A pipe read may split a UTF-8 character. Decode complete lines only.
                while let newline = buffer.firstIndex(of: 0x0A) {
                    let line = buffer[..<newline]
                    if let text = String(data: line, encoding: .utf8) {
                        self.dispatchLine(text, process: process)
                    }
                    buffer.removeSubrange(...newline)
                }
            }
        }
    }

    private func dispatchLine(_ line: String, process: Process) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let event = EngineEvent(json: json) else { return }
        DispatchQueue.main.async { [weak self] in
            guard self?.process === process else { return }
            self?.onEvent?(event)
        }
    }
}
