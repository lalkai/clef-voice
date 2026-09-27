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
}
