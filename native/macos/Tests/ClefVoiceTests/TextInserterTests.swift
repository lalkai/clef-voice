import AppKit
import XCTest
@testable import ClefVoice

@MainActor
private final class TestClipboardStore: ClipboardStore {
    private(set) var changeCount = 0
    private(set) var text: String?
    var writeSucceeds = true

    init(_ text: String? = nil) { self.text = text }

    func snapshot() -> [[NSPasteboard.PasteboardType: Data]] {
        guard let text, let data = text.data(using: .utf8) else { return [] }
        return [[.string: data]]
    }

    func writeText(_ text: String) -> Bool {
        guard writeSucceeds else { return false }
        self.text = text
        changeCount += 1
        return true
    }

    func restore(_ items: [[NSPasteboard.PasteboardType: Data]]) {
        text = items.first?[.string].flatMap { String(data: $0, encoding: .utf8) }
        changeCount += 1
    }

    func userCopies(_ text: String) {
        self.text = text
        changeCount += 1
    }
}

final class TextInserterTests: XCTestCase {
    @MainActor
    func testDeniedPermissionDoesNotReplaceClipboardOrPostPaste() {
        let board = TestClipboardStore("previous")
        let inserter = TextInserter(
            clipboard: board,
            canPaste: { false },
            paste: { XCTFail("Must not post keys without access"); return true }
        )
        var result: Bool?
        inserter.insertText("transcript") { result = $0 }
        XCTAssertEqual(result, false)
        XCTAssertEqual(board.text, "previous")
    }

    @MainActor
    func testDelayedTargetReadsTranscriptBeforeClipboardIsRestored() async throws {
        let board = TestClipboardStore("previous")
        let pasted = expectation(description: "paste dispatched")
        let targetRead = expectation(description: "target reads clipboard")
        let inserter = TextInserter(
            clipboard: board,
            canPaste: { true },
            paste: {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                    XCTAssertEqual(board.text, "transcript")
                    targetRead.fulfill()
                }
                return true
            },
            restoreDelay: 0.25
        )
        inserter.insertText("transcript") { result in
            XCTAssertTrue(result)
            pasted.fulfill()
        }
        await fulfillment(of: [pasted, targetRead], timeout: 2)
        try await Task.sleep(nanoseconds: 350_000_000)
        XCTAssertEqual(board.text, "previous")
    }

    @MainActor
    func testUserClipboardChangeIsPreserved() async throws {
        let board = TestClipboardStore("previous")
        let pasted = expectation(description: "paste dispatched")
        let inserter = TextInserter(
            clipboard: board, canPaste: { true }, paste: { true }, restoreDelay: 0.1
        )
        inserter.insertText("transcript") { _ in
            board.userCopies("new user copy")
            pasted.fulfill()
        }
        await fulfillment(of: [pasted], timeout: 2)
        try await Task.sleep(nanoseconds: 180_000_000)
        XCTAssertEqual(board.text, "new user copy")
    }

    @MainActor
    func testUserCopyBeforePasteDispatchCancelsAutoInput() async {
        let board = TestClipboardStore("previous")
        let finished = expectation(description: "paste cancelled")
        let inserter = TextInserter(
            clipboard: board,
            canPaste: { true },
            paste: { XCTFail("Must not paste a new user copy"); return true }
        )
        inserter.insertText("transcript") { result in
            XCTAssertFalse(result)
            finished.fulfill()
        }
        board.userCopies("new user copy")
        await fulfillment(of: [finished], timeout: 2)
        XCTAssertEqual(board.text, "new user copy")
    }

    @MainActor
    func testBackToBackDictationsRestoreOriginalCopy() async throws {
        let board = TestClipboardStore("previous")
        let first = expectation(description: "first paste")
        let second = expectation(description: "second paste")
        let inserter = TextInserter(
            clipboard: board, canPaste: { true }, paste: { true }, restoreDelay: 0.15
        )
        inserter.insertText("first transcript") { result in
            XCTAssertTrue(result)
            first.fulfill()
        }
        await fulfillment(of: [first], timeout: 2)
        inserter.insertText("second transcript") { result in
            XCTAssertTrue(result)
            second.fulfill()
        }
        await fulfillment(of: [second], timeout: 2)
        try await Task.sleep(nanoseconds: 220_000_000)
        XCTAssertEqual(board.text, "previous")
    }

    @MainActor
    func testSecondDictationDoesNotReplaceClipboardBeforeFirstTargetReadsIt() async {
        let board = TestClipboardStore("previous")
        let firstTargetRead = expectation(description: "first target reads first transcript")
        let secondPasted = expectation(description: "second paste dispatched")
        var pasteCount = 0
        let inserter = TextInserter(
            clipboard: board,
            canPaste: { true },
            paste: {
                pasteCount += 1
                if pasteCount == 1 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                        XCTAssertEqual(board.text, "first transcript")
                        firstTargetRead.fulfill()
                    }
                }
                return true
            },
            restoreDelay: 0.2
        )
        inserter.insertText("first transcript") { result in
            XCTAssertTrue(result)
            inserter.insertText("second transcript") { secondResult in
                XCTAssertTrue(secondResult)
                secondPasted.fulfill()
            }
        }
        await fulfillment(of: [firstTargetRead, secondPasted], timeout: 2)
        XCTAssertEqual(pasteCount, 2)
    }

    @MainActor
    func testFailedClipboardWriteDoesNotPostPaste() {
        let board = TestClipboardStore("previous")
        board.writeSucceeds = false
        let inserter = TextInserter(
            clipboard: board,
            canPaste: { true },
            paste: { XCTFail("Must not post keys after failed clipboard write"); return true }
        )
        var result: Bool?
        inserter.insertText("transcript") { result = $0 }
        XCTAssertEqual(result, false)
        XCTAssertEqual(board.text, "previous")
    }

    func testHistoryTimestampSupportsFractionalSeconds() {
        XCTAssertNotNil(TranscriptionEntry.parseTimestamp("2026-09-24T12:00:00.123456789Z"))
        XCTAssertNotNil(TranscriptionEntry.parseTimestamp("2026-09-24T12:00:00Z"))
        XCTAssertNil(TranscriptionEntry.parseTimestamp(nil))
    }
}
