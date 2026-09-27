import Foundation
import ApplicationServices
import AppKit

@MainActor
protocol ClipboardStore {
    var changeCount: Int { get }
    var text: String? { get }
    func snapshot() -> [[NSPasteboard.PasteboardType: Data]]
    func writeText(_ text: String) -> Bool
    func restore(_ items: [[NSPasteboard.PasteboardType: Data]])
}

@MainActor
private final class SystemClipboardStore: ClipboardStore {
    private let pasteboard: NSPasteboard

    init(_ pasteboard: NSPasteboard) { self.pasteboard = pasteboard }

    var changeCount: Int { pasteboard.changeCount }
    var text: String? { pasteboard.string(forType: .string) }

    func snapshot() -> [[NSPasteboard.PasteboardType: Data]] {
        (pasteboard.pasteboardItems ?? []).map { item in
            item.types.reduce(into: [NSPasteboard.PasteboardType: Data]()) { values, type in
                values[type] = item.data(forType: type)
            }
        }
    }

    func writeText(_ text: String) -> Bool {
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string)
    }

    func restore(_ items: [[NSPasteboard.PasteboardType: Data]]) {
        pasteboard.clearContents()
        let objects = items.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
        }
        if !objects.isEmpty { pasteboard.writeObjects(objects) }
    }
}

@MainActor
public final class TextInserter {

    public static let shared = TextInserter()

    private struct PendingRestore {
        let id: UUID
        let text: String
        let changeCount: Int
        let backup: [[NSPasteboard.PasteboardType: Data]]
    }

    private struct QueuedInsertion {
        let text: String
        let completion: (Bool) -> Void
    }

    private let clipboard: any ClipboardStore
    private let canPaste: () -> Bool
    private let paste: () -> Bool
    private let restoreDelay: TimeInterval
    private var pendingRestore: PendingRestore?
    private var queuedInsertions: [QueuedInsertion] = []
    private var isStartingQueuedInsertion = false

    private convenience init() {
        self.init(clipboard: SystemClipboardStore(.general), canPaste: AXIsProcessTrusted, paste: Self.simulatePaste)
    }

    init(
        clipboard: any ClipboardStore,
        canPaste: @escaping () -> Bool,
        paste: @escaping () -> Bool,
        restoreDelay: TimeInterval = 2
    ) {
        self.clipboard = clipboard
        self.canPaste = canPaste
        self.paste = paste
        self.restoreDelay = restoreDelay
    }

    public func isAccessibilityGranted() -> Bool {
        AXIsProcessTrusted()
    }

    public func insertText(_ text: String, completion: @escaping (Bool) -> Void) {
        guard !text.isEmpty else { completion(false); return }
        // A previous target may still be reading the clipboard. Starting a new
        // paste now could make that target receive this transcript instead.
        if pendingRestore != nil || isStartingQueuedInsertion || !queuedInsertions.isEmpty {
            queuedInsertions.append(QueuedInsertion(text: text, completion: completion))
            startNextInsertion()
            return
        }
        startInsertion(text, completion: completion)
    }

    private func startInsertion(_ text: String, completion: @escaping (Bool) -> Void) {
        // A denied permission must not replace the user's clipboard. The
        // transcript remains available through History for manual copying.
        guard canPaste() else {
            completion(false)
            startNextInsertion()
            return
        }

        let backup = clipboard.snapshot()

        guard clipboard.writeText(text) else {
            clipboard.restore(backup)
            completion(false)
            startNextInsertion()
            return
        }
        let pending = PendingRestore(
            id: UUID(), text: text, changeCount: clipboard.changeCount, backup: backup
        )
        pendingRestore = pending

        // Give callers a chance to finish updating focus without adding a
        // fixed 50 ms delay to every insertion.
        DispatchQueue.main.async { [self] in
            guard ownsClipboard(pending), canPaste(), paste() else {
                finishFailedPaste(pending)
                completion(false)
                return
            }
            completion(true)
            // Some target apps process Cmd+V asynchronously. Restoring after
            // 150 ms could make them read the user's old copy instead.
            DispatchQueue.main.asyncAfter(deadline: .now() + restoreDelay) { [self] in
                guard pendingRestore?.id == pending.id else { return }
                if ownsClipboard(pending) { clipboard.restore(pending.backup) }
                pendingRestore = nil
                startNextInsertion()
            }
        }
    }

    private func ownsClipboard(_ pending: PendingRestore) -> Bool {
        pendingRestore?.id == pending.id &&
            clipboard.changeCount == pending.changeCount &&
            clipboard.text == pending.text
    }

    private func finishFailedPaste(_ pending: PendingRestore) {
        guard pendingRestore?.id == pending.id else { return }
        if ownsClipboard(pending) { clipboard.restore(pending.backup) }
        pendingRestore = nil
        startNextInsertion()
    }

    private func startNextInsertion() {
        guard pendingRestore == nil, !isStartingQueuedInsertion,
              !queuedInsertions.isEmpty else { return }
        isStartingQueuedInsertion = true
        let next = queuedInsertions.removeFirst()
        // Avoid re-entering a caller's completion if a queued paste fails
        // synchronously (for example, Accessibility was revoked).
        DispatchQueue.main.async { [self] in
            isStartingQueuedInsertion = false
            startInsertion(next.text, completion: next.completion)
        }
    }

    private static func simulatePaste() -> Bool {
        let vKeyCode: CGKeyCode = 0x09

        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: vKeyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: vKeyCode, keyDown: false)
        else { return false }

        down.flags = .maskCommand
        up.flags = .maskCommand

        // Post to HID event tap (universal across Terminal, Notion, Browsers, IDEs)
        down.post(tap: .cghidEventTap)
        usleep(30_000)
        up.post(tap: .cghidEventTap)

        return true
    }
}
