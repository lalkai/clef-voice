import XCTest
@testable import ClefVoice

private final class FakeEngine: DictationEngine {
    var onEvent: ((EngineEvent) -> Void)?
    var commands: [[String: Any]] = []
    func launch() {}
    func terminate() {}
    func send(_ command: [String: Any]) { commands.append(command) }
}

final class DictationSessionTests: XCTestCase {
    @MainActor
    func testHotkeyAsksEngineEvenWithoutModelLoadedEvent() async {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        session.start()
        XCTAssertEqual(engine.commands.last?["cmd"] as? String, "start")
        XCTAssertFalse(session.isRecording, "Do not claim recording before engine confirmation")
    }

    @MainActor
    func testLoadingOrEngineErrorDoesNotPermanentlyDisableHotkey() async {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        engine.onEvent?(.status(.loading, "Loading model"))
        engine.onEvent?(.error("Engine process terminated unexpectedly."))
        session.start()
        XCTAssertEqual(engine.commands.last?["cmd"] as? String, "start")
    }

    @MainActor
    func testQuickReleaseStillReachesEngineBeforeRecordingAcknowledgement() async {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        session.start()
        session.stop()
        XCTAssertEqual(engine.commands.compactMap { $0["cmd"] as? String }, ["start", "stop"])
    }

    @MainActor
    func testHeldHotkeyShowsStartingHUDWhenModelIsReady() async {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false, hotkeyIsPressed: { true })
        engine.onEvent?(.modelLoaded(model: "base"))

        session.start()
        XCTAssertTrue(session.isStartingCapture)
        XCTAssertFalse(session.isWaitingForModel)
        engine.onEvent?(.status(.recording, "Listening..."))
        XCTAssertFalse(session.isStartingCapture)
        XCTAssertTrue(session.isRecording)
    }

    @MainActor
    func testHeldHotkeyShowsWaitingHUDAndStartsWhenModelFinishesLoading() async {
        let engine = FakeEngine()
        var held = true
        let session = DictationSession(engine: engine, registerHotkey: false, hotkeyIsPressed: { held })

        session.start()
        XCTAssertTrue(session.isWaitingForModel)
        XCTAssertTrue(session.isStartingCapture, "Held hotkey should show HUD before the engine acknowledges recording")
        engine.onEvent?(.status(.loading, "Initializing model..."))
        XCTAssertTrue(session.isWaitingForModel)
        engine.onEvent?(.modelLoaded(model: "base"))

        XCTAssertFalse(session.isWaitingForModel)
        XCTAssertEqual(engine.commands.compactMap { $0["cmd"] as? String }, ["start", "start"])
        engine.onEvent?(.status(.recording, "Listening..."))
        XCTAssertTrue(session.isRecording)
        XCTAssertFalse(session.isStartingCapture)
        held = false
        session.stop()
    }

    @MainActor
    func testReleasedHotkeyDoesNotStartAfterModelLoads() async {
        let engine = FakeEngine()
        var held = true
        let session = DictationSession(engine: engine, registerHotkey: false, hotkeyIsPressed: { held })

        session.start()
        held = false
        session.stop()
        engine.onEvent?(.modelLoaded(model: "base"))

        XCTAssertFalse(session.isWaitingForModel)
        XCTAssertEqual(engine.commands.compactMap { $0["cmd"] as? String }, ["start", "stop"])
    }

    @MainActor
    func testFailedSettingsSaveDoesNotCancelRecordingOrLoseRelease() async {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        engine.onEvent?(.status(.recording, "Listening..."))
        engine.onEvent?(.error("Could not save settings", recoverable: true))
        XCTAssertTrue(session.isRecording)
        session.stop()
        XCTAssertEqual(engine.commands.last?["cmd"] as? String, "stop")
    }

    @MainActor
    func testEngineTerminationStillClearsRecording() async {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        engine.onEvent?(.status(.recording, "Listening..."))
        engine.onEvent?(.error("Engine process terminated unexpectedly."))
        XCTAssertFalse(session.isRecording)
        XCTAssertFalse(session.isStartingCapture)
    }

    @MainActor
    func testBusyHotkeyDoesNotSendAnotherStart() {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        engine.onEvent?(.status(.transcribing, "Working"))
        session.start()
        XCTAssertFalse(engine.commands.contains { $0["cmd"] as? String == "start" })
    }

    @MainActor
    func testOldInsertionCannotCompleteNewSession() {
        let engine = FakeEngine()
        var callbacks: [(Bool) -> Void] = []
        let session = DictationSession(engine: engine, registerHotkey: false, captureTarget: { PasteTarget(pid: 1, element: nil) }, insert: { _, _, completion in callbacks.append(completion) })
        var notices: [String] = []
        let subscription = session.events.sink { if case .notice(let message) = $0 { notices.append(message) } }
        session.start()
        engine.onEvent?(.status(.transcribing, "A"))
        engine.onEvent?(.transcribed(text: "A", wpm: 1, language: "en", samples: 16000))
        engine.onEvent?(.status(.idle, ""))
        session.start()
        engine.onEvent?(.status(.transcribing, "B"))
        let count = notices.count
        callbacks[0](false)
        XCTAssertEqual(notices.count, count)
        withExtendedLifetime(subscription) {}
    }

    @MainActor
    func testQuickRepressCannotReplaceTargetBeforeCaptureAcknowledgement() {
        let engine = FakeEngine()
        var targetsCaptured: Int32 = 0
        var deliveredTarget: Int32?
        let session = DictationSession(engine: engine, registerHotkey: false, captureTarget: {
            targetsCaptured += 1
            return PasteTarget(pid: targetsCaptured, element: nil)
        }, insert: { _, target, _ in deliveredTarget = target.pid })
        engine.onEvent?(.status(.idle, ""))
        session.start()
        session.stop()
        session.start()
        XCTAssertEqual(targetsCaptured, 1)
        engine.onEvent?(.status(.recording, ""))
        engine.onEvent?(.status(.transcribing, ""))
        engine.onEvent?(.transcribed(text: "A", wpm: 1, language: "en", samples: 16000))
        XCTAssertEqual(deliveredTarget, 1)
        engine.onEvent?(.status(.idle, ""))
        session.start()
        XCTAssertEqual(targetsCaptured, 2)
    }

    @MainActor
    func testRepressAfterReleaseWaitsForTerminalState() {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        engine.onEvent?(.status(.idle, ""))
        session.start()
        engine.onEvent?(.status(.recording, ""))
        session.stop()
        session.start()
        XCTAssertEqual(engine.commands.filter { $0["cmd"] as? String == "start" }.count, 1)
    }

    @MainActor
    func testToggleStopsCaptureBeforeAcknowledgement() {
        let engine = FakeEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        session.toggleDictation()
        session.toggleDictation()
        XCTAssertEqual(engine.commands.compactMap { $0["cmd"] as? String }, ["start", "stop"])
    }

    @MainActor
    func testWireSessionKeepsOriginalPasteTarget() {
        let engine = FakeEngine()
        var deliveredTarget: Int32?
        let session = DictationSession(engine: engine, registerHotkey: false,
            captureTarget: { PasteTarget(pid: 42, element: nil) },
            insert: { _, target, _ in deliveredTarget = target.pid })
        session.start()
        let id = engine.commands.last?["session_id"] as! String
        engine.onEvent?(EngineEvent(json: ["type": "status", "status": "recording", "message": "", "session_id": id])!)
        engine.onEvent?(EngineEvent(json: ["type": "transcribed", "text": "hello", "wpm": 1.0, "language": "en", "samples": 16000, "session_id": id])!)
        XCTAssertEqual(deliveredTarget, 42)
    }

    @MainActor
    func testUnknownWireSessionRetainsTextWithoutPasting() {
        let engine = FakeEngine()
        var pasted = false
        var retained = ""
        var notice = ""
        let session = DictationSession(engine: engine, registerHotkey: false,
            insert: { _, _, _ in pasted = true })
        let subscription = session.events.sink {
            if case .finalTranscription(let text, _) = $0 { retained = text }
            if case .notice(let message) = $0 { notice = message }
        }
        session.start()
        engine.onEvent?(.transcribed(text: "keep this", wpm: 1, language: "en", samples: 16000, sessionID: UUID().uuidString))
        XCTAssertFalse(pasted)
        XCTAssertEqual(retained, "keep this")
        XCTAssertTrue(notice.contains("Copy"))
        withExtendedLifetime(subscription) {}
    }

    func testRecoverableFlagSurvivesProtocolDecoding() {
        guard case .error(_, let recoverable) = EngineEvent(json: ["type": "error", "message": "Save failed", "recoverable": true]) else { return XCTFail("Error was not decoded") }
        XCTAssertTrue(recoverable)
    }
}
