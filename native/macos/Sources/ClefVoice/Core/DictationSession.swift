import Foundation
import Combine
import AppKit

/// Thin session layer bridging the platform shell to the Go core engine.
/// Hotkey → engine start/stop; engine events → DictationEvent + text insertion.
@MainActor
final class DictationSession: ObservableObject {

    let events = PassthroughSubject<DictationEvent, Never>()

    let engine: any DictationEngine
    let hotkeyManager = HotkeyManager.shared
    private let hotkeyIsPressed: @MainActor () -> Bool

    var selectedHotkey: HotkeyType = .launchSelection()
    private var resumeAfterModelLoad = false
    private var engineStatus: AppStatus = .loading
    private var sessionID = UUID()
    private var captureRequested = false
    private var awaitingCompletion = false
    private var targets: [String: PasteTarget] = [:]
    private var target = PasteTarget(pid: nil, element: nil)
    private let captureTarget: @MainActor () -> PasteTarget
    private let insert: @MainActor (String, PasteTarget, @escaping (Bool) -> Void) -> Void

    @Published private(set) var isRecording = false
    @Published private(set) var isWaitingForModel = false
    @Published private(set) var isStartingCapture = false

    init(
        engine: any DictationEngine = EngineClient(),
        registerHotkey: Bool = true,
        captureTarget: @escaping @MainActor () -> PasteTarget = { PasteTarget.current() },
        insert: @escaping @MainActor (String, PasteTarget, @escaping (Bool) -> Void) -> Void = { TextInserter.shared.insertText($0, target: $1, completion: $2) },
        hotkeyIsPressed: @escaping @MainActor () -> Bool = { HotkeyManager.shared.isKeyDown }
    ) {
        self.captureTarget = captureTarget
        self.insert = insert
        self.engine = engine
        self.hotkeyIsPressed = hotkeyIsPressed
        engine.onEvent = { [weak self] event in
            // EngineClient delivers callbacks on the main queue, in wire order.
            MainActor.assumeIsolated { self?.handle(event) }
        }
        // A missing/legacy config must never leave the default hotkey unregistered.
        if registerHotkey { setupHotkey() }
        engine.launch()
    }

    func setupHotkey() {
        hotkeyManager.registerHotkey(
            combination: HotkeyCombination(type: selectedHotkey),
            onKeyDown: { [weak self] in self?.start() },
            onKeyUp:   { [weak self] in self?.stop()  }
        )
    }

    func toggleDictation() { (isRecording || isStartingCapture || isWaitingForModel || captureRequested) ? stop() : start() }

    func start() {
        guard !isRecording, !captureRequested, !awaitingCompletion, engineStatus != .transcribing, engineStatus != .recording else { return }
        sessionID = UUID()
        target = captureTarget()
        targets = [sessionID.uuidString: target]
        events.send(.notice(""))
        // The engine owns readiness; recovery never replays a recording command.
        Log.hotkey.notice("Dictation start requested")
        resumeAfterModelLoad = hotkeyIsPressed()
        isStartingCapture = resumeAfterModelLoad
        isWaitingForModel = resumeAfterModelLoad && (engineStatus == .loading || engineStatus == .downloading)
        captureRequested = true
        engine.send(["cmd": "start", "session_id": sessionID.uuidString])
    }

    func stop() {
        if captureRequested || isRecording { awaitingCompletion = true }
        resumeAfterModelLoad = false
        isStartingCapture = false
        isWaitingForModel = false
        if isRecording {
            NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
        }
        isRecording = false
        engine.send(["cmd": "stop"])
    }

    private func handle(_ event: EngineEvent) {
        switch event {
        case .connection(let connected, let generation, let message):
            resumeAfterModelLoad = false
            isStartingCapture = false
            isWaitingForModel = false
            isRecording = false
            sessionID = UUID()
            targets.removeAll()
            captureRequested = false
            awaitingCompletion = false
            engineStatus = connected ? .loading : .error
            events.send(.connection(connected: connected, generation: generation, message: message))
            events.send(.statusChanged(engineStatus, message))
        case .ready:
            events.send(.statusChanged(.loading, "Preparing model..."))
            engine.send(["cmd": "get_state"])

        case .status(let status, let message, let acknowledgedSession):
            let previous = engineStatus
            engineStatus = status
            if status == .loading || status == .downloading || (status == .idle && previous != .idle) {
                captureRequested = false
                awaitingCompletion = false
            }
            if status == .recording || status == .transcribing { captureRequested = false }
            if status == .recording, let acknowledgedSession, let id = UUID(uuidString: acknowledgedSession) {
                sessionID = id
                target = targets[acknowledgedSession] ?? PasteTarget(pid: nil, element: nil)
            }
            if status == .idle && (previous == .recording || previous == .transcribing) { targets.removeAll() }
            if status == .recording {
                resumeAfterModelLoad = false
                isStartingCapture = false
                isWaitingForModel = false
                isRecording = true
                NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
            }
            if status != .recording {
                isRecording = false
                // While a model is loading, keep the held key and retry once
                // the engine reports that the model is ready.
                if status == .idle {
                    isWaitingForModel = false
                    resumePendingStartIfHeld()
                } else if status == .loading || status == .downloading {
                    isWaitingForModel = resumeAfterModelLoad && hotkeyIsPressed()
                } else {
                    resumeAfterModelLoad = false
                    isStartingCapture = false
                    isWaitingForModel = false
                    hotkeyManager.resetState()
                }
            }
            events.send(.statusChanged(status, message))

        case .level(let level):
            events.send(.audioLevelUpdated(level))

        case .transcribed(let text, let wpm, let language, _, let id):
            finalize(text, wpm: wpm, language: language, id: id)

        case .modelProgress(let model, let progress, let downloading):
            events.send(.modelProgress(model: model, progress: progress, downloading: downloading))

        case .modelLoaded(let model):
            engineStatus = .idle
            captureRequested = false
            awaitingCompletion = false
            isWaitingForModel = false
            events.send(.statusChanged(.idle, "Model '\(model)' ready."))
            resumePendingStartIfHeld()

        case .history(let items):
            events.send(.history(items))

        case .stats(let stats):
            events.send(.stats(stats))

        case .models(let snapshot):
            events.send(.models(snapshot))

        case .config(let cfg):
            events.send(.config(cfg))

        case .error(let message, let recoverable):
            if recoverable {
                events.send(.notice(message))
                return
            }
            resumeAfterModelLoad = false
            isStartingCapture = false
            isWaitingForModel = false
            engineStatus = .error
            captureRequested = false
            awaitingCompletion = false
            isRecording = false
            hotkeyManager.resetState()
            events.send(.statusChanged(.error, message))
        }
    }

    private func resumePendingStartIfHeld() {
        guard resumeAfterModelLoad else { return }
        resumeAfterModelLoad = false
        guard hotkeyIsPressed() else { return }
        Log.hotkey.notice("Starting held dictation after model became ready")
        captureRequested = true
        engine.send(["cmd": "start", "session_id": sessionID.uuidString])
    }

    private func finalize(_ text: String, wpm: Double, language: String, id: String?) {
        isRecording = false
        isStartingCapture = false
        isWaitingForModel = false
        hotkeyManager.resetState()
        guard !text.isEmpty else {
            events.send(.statusChanged(.idle, "No speech detected."))
            return
        }
        events.send(.finalTranscription(text, wpm, language))
        let completedSession = id.flatMap(UUID.init(uuidString:)) ?? sessionID
        let deliveryTarget: PasteTarget
        if let id {
            guard let original = targets.removeValue(forKey: id) else {
                events.send(.notice("Could not confirm the original target. Copy the latest transcript."))
                return
            }
            deliveryTarget = original
        } else { deliveryTarget = target }
        insert(text, deliveryTarget) { [weak self] pasted in
            guard let self, self.sessionID == completedSession else { return }
            self.events.send(.notice(pasted ? "" : "Text was not inserted: check Accessibility, focus and clipboard. Copy the latest transcript."))
        }
    }
}
