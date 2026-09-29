import XCTest
@testable import ClefVoice

final class VoiceAudioSettingsTests: XCTestCase {
    @MainActor
    func testAudioSettingsKeepPresetValuesAcrossJSONBridge() async throws {
        for threshold in [0.005, 0.012, 0.025] {
            let input: [String: Any] = ["vadThreshold": threshold, "vadEnabled": false, "autoStopEnabled": true, "autoStopSeconds": 1.2]
            let webData = try JSONSerialization.data(withJSONObject: input)
            let webJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: webData) as? [String: Any])
            let patch = MainWindowController.engineConfigPatch(webJSON)
            let engineData = try JSONSerialization.data(withJSONObject: patch)
            let engineJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: engineData) as? [String: Any])
            XCTAssertEqual((engineJSON["vad_threshold"] as? NSNumber)?.doubleValue, threshold)
            XCTAssertEqual(engineJSON["vad_enabled"] as? Bool, false)
            XCTAssertEqual(engineJSON["auto_stop_enabled"] as? Bool, true)
            XCTAssertEqual(engineJSON["auto_stop_seconds"] as? Double, 1.2)
            XCTAssertEqual(patch.count, 4)
        }
    }
}
