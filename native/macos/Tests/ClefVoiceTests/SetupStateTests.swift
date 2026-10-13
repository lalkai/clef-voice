import XCTest
@testable import ClefVoice

final class SetupStateTests: XCTestCase {
    private let readyInventory: [String: Any] = ["busy":false, "items":[["active":true,"downloaded":true,"status":"downloaded"]]]

    func testSetupCompletionSurvivesReopeningItsPreferencesStore() throws {
        let name = "ClefVoiceTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName:name))
        defer { defaults.removePersistentDomain(forName:name) }
        XCTAssertFalse(SetupState.completed(defaults:defaults))
        XCTAssertTrue(SetupState.complete(permissionsGranted:true,status:.idle,inventory:readyInventory,defaults:defaults))
        let reopened = try XCTUnwrap(UserDefaults(suiteName:name))
        XCTAssertTrue(SetupState.completed(defaults:reopened))
    }

    func testBusyOrRevokedPermissionDoesNotCompleteSetup() throws {
        let name = "ClefVoiceTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName:name))
        defer { defaults.removePersistentDomain(forName:name) }
        var busy = readyInventory
        busy["busy"] = true
        XCTAssertFalse(SetupState.complete(permissionsGranted:true,status:.idle,inventory:busy,defaults:defaults))
        XCTAssertFalse(SetupState.complete(permissionsGranted:false,status:.idle,inventory:readyInventory,defaults:defaults))
        XCTAssertFalse(SetupState.complete(permissionsGranted:true,status:.loading,inventory:readyInventory,defaults:defaults))
        XCTAssertFalse(SetupState.complete(permissionsGranted:true,status:.idle,inventory:["items":[]],defaults:defaults))
        XCTAssertFalse(SetupState.completed(defaults:defaults))
    }
}
