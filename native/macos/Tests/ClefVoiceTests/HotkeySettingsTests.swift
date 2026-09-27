import XCTest
@testable import ClefVoice

final class HotkeySettingsTests: XCTestCase {
    func testGoDefaultAndLegacySettingsResolveToNativeHotkeys() {
        let fixtures: [(String, HotkeyType)] = [
            ("leftControl", .leftControl),
            ("leftOption", .leftOption),
            ("rightOption", .rightOption),
            ("fnKey", .fn),
            ("optionSpace", .optionSpace),
            ("commandSpace", .commandSpace),
        ]
        for (saved, expected) in fixtures {
            XCTAssertEqual(HotkeyType(persistedValue: saved), expected, saved)
        }
    }

    func testNativeSavedValuesRemainCompatible() {
        for type in HotkeyType.allCases {
            XCTAssertEqual(HotkeyType(persistedValue: type.rawValue), type)
        }
    }

    func testInvalidValuesDoNotInventAHotkey() {
        XCTAssertNil(HotkeyType(persistedValue: ""))
        XCTAssertNil(HotkeyType(persistedValue: "not-a-hotkey"))
        XCTAssertEqual(HotkeyType(persistedValue: " LeftControl\n"), .leftControl)
    }

    func testSavedHotkeyIsAvailableBeforeEngineConfigArrives() throws {
        let configURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("ClefVoiceHotkeyTests.\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: configURL) }

        XCTAssertEqual(HotkeyType.launchSelection(configURL: configURL), .fn)
        XCTAssertEqual(HotkeyCombination.defaultCombination.type, .fn)
        try Data("{\"hotkey\":\"LeftControl\"}".utf8).write(to: configURL)
        XCTAssertEqual(HotkeyType.launchSelection(configURL: configURL), .leftControl)
        try Data("{\"hotkey\":\"Fn\"}".utf8).write(to: configURL)
        XCTAssertEqual(HotkeyType.launchSelection(configURL: configURL), .fn)
    }
    func testModifierSidesAndFnUseEventState() {
        XCTAssertTrue(HotkeyCombination(type: .leftControl).modifierIsPressed(flags: 0x40001))
        XCTAssertFalse(HotkeyCombination(type: .leftControl).modifierIsPressed(flags: 0x42000))
        XCTAssertTrue(HotkeyCombination(type: .leftOption).modifierIsPressed(flags: 0x80020))
        XCTAssertFalse(HotkeyCombination(type: .leftOption).modifierIsPressed(flags: 0x80040))
        XCTAssertTrue(HotkeyCombination(type: .rightOption).modifierIsPressed(flags: 0x80040))
        XCTAssertFalse(HotkeyCombination(type: .rightOption).modifierIsPressed(flags: 0x80020))
        XCTAssertTrue(HotkeyCombination(type: .fn).modifierIsPressed(flags: 0x800000))
        XCTAssertFalse(HotkeyCombination(type: .fn).modifierIsPressed(flags: 0))
    }

    func testFnAcceptsGlobeKeyCodeWhileOtherModifiersKeepTheirSide() {
        XCTAssertTrue(HotkeyCombination(type: .fn).matchesModifierEvent(keyCode: 63))
        XCTAssertTrue(HotkeyCombination(type: .fn).matchesModifierEvent(keyCode: 179))
        XCTAssertTrue(HotkeyCombination(type: .leftOption).matchesModifierEvent(keyCode: 58))
        XCTAssertFalse(HotkeyCombination(type: .leftOption).matchesModifierEvent(keyCode: 61))
    }

}
