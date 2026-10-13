import Foundation
import Darwin

/// Events emitted by the Go core engine (`clefd`) over stdio.
enum EngineEvent {
    case connection(connected: Bool, generation: Int, message: String)
    case ready(version: String)
    case status(AppStatus, String, sessionID: String? = nil)
    case level(Float)
    case transcribed(text: String, wpm: Double, language: String, samples: Int, sessionID: String? = nil)
    case modelProgress(model: String, progress: Double, downloading: Bool)
    case modelLoaded(model: String)
    case history([Any])
    case stats([String: Any])
    case config([String: Any])
    case models([String: Any])
    case error(String, recoverable: Bool = false)
}

extension EngineEvent {
    init?(json: [String: Any]) {
        guard let type = json["type"] as? String else { return nil }
        switch type {
        case "ready":
            self = .ready(version: json["version"] as? String ?? "")
        case "status":
            let raw = json["status"] as? String ?? "idle"
            self = .status(AppStatus(rawValue: raw) ?? .idle, json["message"] as? String ?? "", sessionID: json["session_id"] as? String)
        case "level":
            self = .level((json["level"] as? NSNumber)?.floatValue ?? 0)
        case "transcribed":
            self = .transcribed(
                text: json["text"] as? String ?? "",
                wpm: (json["wpm"] as? NSNumber)?.doubleValue ?? 0,
                language: json["language"] as? String ?? "",
                samples: (json["samples"] as? NSNumber)?.intValue ?? 0,
                sessionID: json["session_id"] as? String
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
        case "models":
            self = .models(json["models"] as? [String: Any] ?? [:])
        case "config":
            self = .config(json["config"] as? [String: Any] ?? [:])
        case "error":
            self = .error(json["message"] as? String ?? "Unknown error", recoverable: json["recoverable"] as? Bool ?? false)
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
    func request(_ command: [String: Any], accepted: @escaping () -> Void, completion: @escaping (Result<Any?, Error>) -> Void)
    func retry()
    func shutdown(completion: @escaping () -> Void)
}

extension DictationEngine {
    func request(_ command: [String: Any], accepted: @escaping () -> Void, completion: @escaping (Result<Any?, Error>) -> Void) {
        completion(.failure(EngineFailure("Engine requests are unavailable.")))
    }
    func retry() { launch() }
    func shutdown(completion: @escaping () -> Void) { terminate(); completion() }
}

struct EngineFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

public final class EngineClient: DictationEngine {
    var onEvent: ((EngineEvent) -> Void)?
    private var process: Process?
    private var inputHandle: FileHandle?
    private let writeLock = NSLock()
    private let enginePath: () -> String?
    private let environment: [String: String]?
    private let arguments: [String]
    private let retryDelay: TimeInterval
    private let retryLimit: Int
    private var retries = 0
    private var generation = 0
    private var stopping = false
    private var retryWork: DispatchWorkItem?
    private struct Request {
        let accepted: () -> Void
        let completion: (Result<Any?, Error>) -> Void
        let timeout: DispatchWorkItem
    }
    private var requests: [String: Request] = [:]

    public convenience init() { self.init(enginePath: Self.locateEngine) }
    init(enginePath: @escaping () -> String?, environment: [String: String]? = nil, arguments: [String] = [], retryDelay: TimeInterval = 0.5, retryLimit: Int = 3) {
        signal(SIGPIPE, SIG_IGN)
        self.environment = environment
        self.arguments = arguments
        self.enginePath = enginePath
        self.retryDelay = retryDelay
        self.retryLimit = retryLimit
    }

    func launch() {
        guard !stopping, process?.isRunning != true else { return }
        retryWork?.cancel()
        retryWork = nil
        generation += 1
        guard let path = enginePath() else { unavailable("Engine binary not found."); return }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: path)
        proc.environment = environment ?? ProcessInfo.processInfo.environment
        proc.arguments = arguments
        let output = Pipe(), errors = Pipe(), input = Pipe()
        proc.standardOutput = output
        proc.standardError = errors
        proc.standardInput = input
        process = proc
        inputHandle = input.fileHandleForWriting
        errors.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { FileHandle.standardError.write(data) }
        }
        proc.terminationHandler = { [weak self] terminated in
            errors.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                guard let self, self.process === terminated else { return }
                self.process = nil
                self.inputHandle = nil
                if !self.stopping { self.unavailable("Engine stopped. Retry to reconnect.") }
            }
        }
        do { try proc.run() }
        catch {
            inputHandle = nil
            process = nil
            errors.fileHandleForReading.readabilityHandler = nil
            unavailable("Could not launch engine: \(error.localizedDescription)")
            return
        }
        onEvent?(.connection(connected: true, generation: generation, message: ""))
        readLines(from: output.fileHandleForReading, process: proc)
    }

    func retry() {
        guard process?.isRunning != true else { return }
        stopping = false
        retries = 0
        launch()
    }

    private func unavailable(_ message: String) {
        failRequests(message)
        onEvent?(.connection(connected: false, generation: generation, message: message))
        guard !stopping, retryWork == nil, retries < retryLimit else { return }
        let delay = retryDelay * pow(2, Double(retries))
        retries += 1
        let work = DispatchWorkItem { [weak self] in self?.launch() }
        retryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    func send(_ command: [String: Any]) {
        do { try write(command) }
        catch { onEvent?(.error(error.localizedDescription, recoverable: true)) }
    }

    func request(_ command: [String: Any], accepted: @escaping () -> Void, completion: @escaping (Result<Any?, Error>) -> Void) {
        let id = UUID().uuidString
        var command = command
        command["request_id"] = id
        let timeout = DispatchWorkItem { [weak self] in
            guard let request = self?.requests.removeValue(forKey: id) else { return }
            request.completion(.failure(EngineFailure("Engine did not acknowledge the request.")))
        }
        requests[id] = Request(accepted: accepted, completion: completion, timeout: timeout)
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: timeout)
        do { try write(command) }
        catch {
            requests.removeValue(forKey: id)?.timeout.cancel()
            completion(.failure(error))
        }
    }

    private func write(_ command: [String: Any]) throws {
        guard let handle = inputHandle, process?.isRunning == true else { throw EngineFailure("Engine unavailable. Retry to reconnect.") }
        var bytes = try JSONSerialization.data(withJSONObject: command)
        bytes.append(0x0A)
        guard bytes.count <= AppConfig.commandBytes else { throw EngineFailure("Command is too large." ) }
        writeLock.lock()
        defer { writeLock.unlock() }
        do { try handle.write(contentsOf: bytes) }
        catch {
            inputHandle = nil
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.process?.terminate()
                self.failRequests("Engine pipe closed.")
            }
            throw EngineFailure("Could not send command to engine.")
        }
    }

    private func failRequests(_ message: String) {
        let pending = requests
        requests.removeAll()
        for request in pending.values {
            request.timeout.cancel()
            request.completion(.failure(EngineFailure(message)))
        }
    }

    func terminate() {
        stopping = true
        retryWork?.cancel()
        retryWork = nil
        failRequests("Engine is shutting down.")
        guard let proc = process else { return }
        try? write(["cmd": "shutdown"])
        try? inputHandle?.close()
        inputHandle = nil
        // Keep the run loop free while Go cancels downloads and cleans temporary files.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if proc.isRunning { proc.terminate() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                if proc.isRunning { kill(proc.processIdentifier, SIGKILL) }
            }
        }
    }

    func shutdown(completion: @escaping () -> Void) {
        let proc = process
        terminate()
        guard let proc, proc.isRunning else { completion(); return }
        DispatchQueue.global().async {
            proc.waitUntilExit()
            DispatchQueue.main.async(execute: completion)
        }
    }

    private static func locateEngine() -> String? {
        if let override = ProcessInfo.processInfo.environment["CLEF_ENGINE"] { return override }
        for path in ["Contents/MacOS/clefd", "Contents/Resources/clefd"] {
            let url = Bundle.main.bundleURL.appendingPathComponent(path)
            if FileManager.default.fileExists(atPath: url.path) { return url.path }
        }
        return nil
    }

    private func readLines(from handle: FileHandle, process: Process) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var buffer = Data()
            while true {
                let data = handle.availableData
                if data.isEmpty { break }
                buffer.append(data)
                while let newline = buffer.firstIndex(of: 0x0A) {
                    let line = Data(buffer[..<newline])
                    buffer.removeSubrange(...newline)
                    guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
                    DispatchQueue.main.async { [weak self] in
                        guard let self, self.process === process else { return }
                        if json["type"] as? String == "command_result", let id = json["request_id"] as? String,
                           let request = self.requests[id] {
                            request.timeout.cancel()
                            if json["state"] as? String == "accepted" { request.accepted(); return }
                            self.requests.removeValue(forKey: id)
                            if json["state"] as? String == "completed" { request.completion(.success(json["result"])) }
                            else { request.completion(.failure(EngineFailure(json["message"] as? String ?? "Operation failed."))) }
                        } else if let event = EngineEvent(json: json) { self.onEvent?(event) }
                    }
                }
            }
        }
    }
}
