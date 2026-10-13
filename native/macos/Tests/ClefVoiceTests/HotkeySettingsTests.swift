import XCTest
import AppKit
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


    func testRecordedCombinationPersistsAndMatchesExactModifiers() throws {
        let hotkey = try XCTUnwrap(HotkeyType.recorded(keyCode: 2, flags: [.control, .shift]))
        XCTAssertEqual(hotkey.shortName, "⌃⇧D")
        let restored = try XCTUnwrap(HotkeyType(persistedValue: hotkey.rawValue))
        XCTAssertEqual(restored, hotkey)
        XCTAssertEqual(try JSONDecoder().decode(HotkeyType.self, from: JSONEncoder().encode(hotkey)), hotkey)
        let combo = HotkeyCombination(type: restored)
        XCTAssertEqual(combo.keyCode, 2)
        XCTAssertFalse(combo.isModifierOnly)
        XCTAssertTrue(combo.modifierIsPressed(flags: 0x60000))
        XCTAssertFalse(combo.modifierIsPressed(flags: 0x40000))
        XCTAssertFalse(combo.modifierIsPressed(flags: 0x160000))
    }

    func testRecorderPreservesFnAndRejectsTypingOrReservedKeys() {
        XCTAssertEqual(HotkeyType.recorded(keyCode: 63, flags: [.function]), .fn)
        XCTAssertEqual(HotkeyType.recorded(keyCode: 179, flags: [.function]), .fn)
        XCTAssertEqual(HotkeyType.recorded(keyCode: 58, flags: [.option]), .leftOption)
        XCTAssertNil(HotkeyType.recorded(keyCode: 0, flags: []))
        XCTAssertNil(HotkeyType.recorded(keyCode: 12, flags: [.command]))
        XCTAssertNil(HotkeyType(persistedValue: "Custom:999:1048576"))
        XCTAssertNil(HotkeyType(persistedValue: "Custom:2:0"))
    }

    func testCustomRightControlKeepsItsSide() throws {
        let hotkey = try XCTUnwrap(HotkeyType.recorded(keyCode: 62, flags: [.control]))
        let combo = HotkeyCombination(type: hotkey)
        XCTAssertTrue(combo.isModifierOnly)
        XCTAssertTrue(combo.modifierIsPressed(flags: 0x42000))
        XCTAssertFalse(combo.modifierIsPressed(flags: 0x40001))
    }

    func testCustomHotkeyRestoresOnLaunch() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let hotkey = try XCTUnwrap(HotkeyType.recorded(keyCode: 40, flags: [.option, .shift]))
        try JSONSerialization.data(withJSONObject: ["hotkey": hotkey.rawValue]).write(to: url)
        XCTAssertEqual(HotkeyType.launchSelection(configURL: url), hotkey)
    }
}
