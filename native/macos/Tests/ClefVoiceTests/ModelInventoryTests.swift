import XCTest
import Combine
@testable import ClefVoice

private final class InventoryEngine: DictationEngine {
    var onEvent: ((EngineEvent) -> Void)?
    func launch() {}
    func terminate() {}
    func send(_ command: [String: Any]) {}
}

final class ModelInventoryTests: XCTestCase {
    @MainActor
    func testModelInventoryPreservesLifecycleAndByteProgressThroughSession() {
        let engine = InventoryEngine()
        let session = DictationSession(engine: engine, registerHotkey: false)
        var received: [String: Any]?
        let subscription = session.events.sink { event in
            if case .models(let snapshot) = event { received = snapshot }
        }
        let snapshot: [String: Any] = [
            "busy": true,
            "items": [["id": "small", "status": "downloading", "receivedBytes": 200_000_000, "totalBytes": 466_000_000, "progress": 0.42, "active": false]],
        ]
        let parsed = EngineEvent(json: ["type": "models", "models": snapshot])
        XCTAssertNotNil(parsed)
        if let parsed { engine.onEvent?(parsed) }
        XCTAssertEqual(received?["busy"] as? Bool, true)
        let item = (received?["items"] as? [[String: Any]])?.first
        XCTAssertEqual(item?["status"] as? String, "downloading")
        XCTAssertEqual(item?["receivedBytes"] as? Int, 200_000_000)
        XCTAssertEqual(item?["totalBytes"] as? Int, 466_000_000)
        XCTAssertEqual(item?["progress"] as? Double, 0.42)
        XCTAssertFalse(session.isRecording)
        withExtendedLifetime(subscription) {}
    }
}
