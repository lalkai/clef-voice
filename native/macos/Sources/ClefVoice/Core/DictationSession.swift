import Foundation
import Combine
import AppKit

/// Thin session layer bridging the platform shell to the Go core engine.
/// Hotkey → engine start/stop; engine events → DictationEvent + text insertion.
@MainActor
final class DictationSession: ObservableObject {

    let events = PassthroughSubject<DictationEvent, Never>()

    let engine: any DictationEngine
    let textInserter = TextInserter.shared
    let hotkeyManager = HotkeyManager.shared
    private let hotkeyIsPressed: @MainActor () -> Bool

    var selectedHotkey: HotkeyType = .launchSelection()
    private var resumeAfterModelLoad = false
    private var engineStatus: AppStatus = .loading

    @Published private(set) var isRecording = false
    @Published private(set) var isWaitingForModel = false
    @Published private(set) var isStartingCapture = false

    init(
        engine: any DictationEngine = EngineClient(),
        registerHotkey: Bool = true,
        hotkeyIsPressed: @escaping @MainActor () -> Bool = { HotkeyManager.shared.isKeyDown }
    ) {
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

    func loadModel(model: String) {
        engine.send(["cmd": "load_model", "model": model])
    }

    func toggleDictation() { isRecording ? stop() : start() }

    func start() {
        guard !isRecording else { return }
        // The engine owns readiness. A missed model_loaded event must not leave
        // the hotkey silently disabled or prevent a dead engine from restarting.
        Log.hotkey.notice("Dictation start requested")
        resumeAfterModelLoad = hotkeyIsPressed()
        isStartingCapture = resumeAfterModelLoad
        isWaitingForModel = resumeAfterModelLoad && (engineStatus == .loading || engineStatus == .downloading)
        engine.send(["cmd": "start"])
    }

    func stop() {
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
        case .ready:
            events.send(.statusChanged(.loading, "Preparing model..."))
            engine.send(["cmd": "get_state"])

        case .status(let status, let message):
            engineStatus = status
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

        case .transcribed(let text, let wpm, _, _):
            finalize(text, wpm: wpm)

        case .modelProgress(let model, let progress, let downloading):
            events.send(.modelProgress(model: model, progress: progress, downloading: downloading))

        case .modelLoaded(let model):
            engineStatus = .idle
            isWaitingForModel = false
            events.send(.statusChanged(.idle, "Model '\(model)' ready."))
            resumePendingStartIfHeld()

        case .history(let items):
            events.send(.history(items))

        case .stats(let stats):
            events.send(.stats(stats))

        case .config(let cfg):
            events.send(.config(cfg))

        case .error(let message):
            resumeAfterModelLoad = false
            isStartingCapture = false
            isWaitingForModel = false
            engineStatus = .error
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
        engine.send(["cmd": "start"])
    }

    private func finalize(_ text: String, wpm: Double) {
        isRecording = false
        isStartingCapture = false
        isWaitingForModel = false
        hotkeyManager.resetState()
        guard !text.isEmpty else {
            events.send(.statusChanged(.idle, "No speech detected."))
            return
        }
        events.send(.finalTranscription(text, wpm))
        textInserter.insertText(text) { [weak self] pasted in
            // The paste callback may arrive after a new model load has started.
            // Never let an old transcription replace the engine's current state.
            guard let self, !self.isRecording, self.engineStatus == .transcribing else { return }
            self.engineStatus = .idle
            self.events.send(.statusChanged(.idle, pasted ? "Paste sent." : "Not inserted. Copy the transcript from History."))
        }
    }
}
