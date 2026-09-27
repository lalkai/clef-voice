import Foundation
import Carbon
import AppKit

public enum HotkeyType: String, CaseIterable, Identifiable, Codable {
    case leftControl = "LeftControl"
    case fn = "Fn"
    case leftOption = "LeftOption"
    case rightOption = "RightOption"
    case optionSpace = "OptionSpace"
    case commandSpace = "CommandSpace"

    // The Go config arrives over stdio after launch. Read the same file first so
    // registration and the initial Settings snapshot use one saved hotkey.
    static func launchSelection(
        configURL: URL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".clefvoice/config.json")
    ) -> HotkeyType {
        guard let data = try? Data(contentsOf: configURL),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = config["hotkey"] as? String,
              let hotkey = HotkeyType(persistedValue: value) else { return .fn }
        return hotkey
    }

    // Go defaults and older web settings used lower-camel-case identifiers.
    // Keep the native raw values stable while accepting existing saved configs.
    public init?(persistedValue: String) {
        let value = persistedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.lowercased() == "fnkey" {
            self = .fn
        } else if let type = Self.allCases.first(where: { $0.rawValue.caseInsensitiveCompare(value) == .orderedSame }) {
            self = type
        } else {
            return nil
        }
    }

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .leftControl: "⌃ Left Control"
        case .fn: "Fn Key"
        case .leftOption: "⌥ Left Option Key"
        case .rightOption: "⌥ Right Option Key"
        case .optionSpace: "⌥ Option + Space"
        case .commandSpace: "⌘ Command + Space"
        }
    }

    public var shortName: String {
        switch self {
        case .leftControl: "⌃ Control"
        case .fn: "Fn"
        case .leftOption: "⌥ L-Option"
        case .rightOption: "⌥ R-Option"
        case .optionSpace: "⌥Space"
        case .commandSpace: "⌘Space"
        }
    }
}

public struct HotkeyCombination: Codable, Equatable {
    public var type: HotkeyType
    public static let defaultCombination = HotkeyCombination(type: .fn)

    public init(type: HotkeyType) { self.type = type }

    public var keyCode: UInt32 {
        switch type {
        case .leftControl: 59
        case .fn: 63
        case .leftOption: 58
        case .rightOption: 61
        case .optionSpace, .commandSpace: UInt32(kVK_Space)
        }
    }

    func modifierIsPressed(flags: UInt64) -> Bool {
        // Device-specific masks from IOKit/hidsystem/IOLLEvent.h preserve sides.
        // Use event flags here: querying global key state inside a tap can race
        // with the event which is currently being delivered.
        switch type {
        case .leftControl: return flags & 0x00000001 != 0
        case .leftOption: return flags & 0x00000020 != 0
        case .rightOption: return flags & 0x00000040 != 0
        case .fn: return flags & CGEventFlags.maskSecondaryFn.rawValue != 0
        case .optionSpace: return flags & CGEventFlags.maskAlternate.rawValue != 0
        case .commandSpace: return flags & CGEventFlags.maskCommand.rawValue != 0
        }
    }

    func matchesModifierEvent(keyCode: UInt16) -> Bool {
        type == .fn || keyCode == UInt16(self.keyCode)
    }

    public var modifierFlag: NSEvent.ModifierFlags {
        switch type {
        case .leftControl: .control
        case .fn: .function
        case .leftOption, .rightOption, .optionSpace: .option
        case .commandSpace: .command
        }
    }
}

public final class HotkeyManager {

    public static let shared = HotkeyManager()

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var eventTapHadAccessibility = false

    private var globalKeyDown: Any?
    private var globalKeyUp: Any?
    private var globalFlags: Any?
    private var localKeyDown: Any?
    private var localKeyUp: Any?
    private var localFlags: Any?
    private var registrationRetry: Timer?

    public private(set) var isKeyDown: Bool = false
    private var combination: HotkeyCombination = .defaultCombination
    private var onKeyDown: (() -> Void)?
    private var onKeyUp: (() -> Void)?

    private init() {}

    deinit { unregister() }

    public func registerHotkey(
        combination: HotkeyCombination = .defaultCombination,
        onKeyDown: @escaping () -> Void,
        onKeyUp: @escaping () -> Void
    ) {
        if self.onKeyDown != nil, self.combination == combination {
            // Config acknowledgements must not tear down a working event tap or
            // reset a key which the user is currently holding.
            self.onKeyDown = onKeyDown
            self.onKeyUp = onKeyUp
            refreshRegistration()
            return
        }
        if isKeyDown { self.onKeyUp?() }
        unregister()
        self.combination = combination
        self.onKeyDown = onKeyDown
        self.onKeyUp = onKeyUp

        refreshRegistration()
    }

    private func startRegistrationRetry() {
        guard registrationRetry == nil else { return }
        let retry = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            self?.refreshRegistration()
        }
        registrationRetry = retry
        RunLoop.main.add(retry, forMode: .common)
    }

    /// Recover after permission is granted without requiring a setting change.
    public func refreshRegistration() {
        guard onKeyDown != nil else { return }
        let hasAccessibility = AXIsProcessTrusted()
        let hasInputMonitoring = CGPreflightListenEventAccess()
        if let tap = eventTap {
            // A tap created before Accessibility was granted is listen-only and
            // may have had keyboard events removed from its event mask. Rebuild
            // it when the permission changes instead of keeping a silent tap.
            if eventTapHadAccessibility == hasAccessibility {
                if !CGEvent.tapIsEnabled(tap: tap) {
                    CGEvent.tapEnable(tap: tap, enable: true)
                }
                if CGEvent.tapIsEnabled(tap: tap) { return }
            }
            removeCGEventTap()
        }
        if !hasInputMonitoring { removeNSEventMonitors() }
        // Neither an event tap nor a global keyboard monitor should be created
        // before the user grants access from Settings. Creating either here can
        // make macOS show an Input Monitoring prompt on first launch.
        guard hasAccessibility || hasInputMonitoring else {
            removeNSEventMonitors()
            startRegistrationRetry()
            return
        }
        guard setupCGEventTap(hasAccessibility: hasAccessibility) else {
            if hasInputMonitoring && globalFlags == nil {
                setupNSEventMonitors()
            }
            startRegistrationRetry()
            return
        }
        removeNSEventMonitors()
        registrationRetry?.invalidate()
        registrationRetry = nil
        Log.hotkey.notice("Recovered CGEventTap: \(self.combination.type.displayName)")
    }

    private var isModifierOnly: Bool {
        switch combination.type {
        case .fn, .leftOption, .rightOption, .leftControl:
            return true
        default:
            return false
        }
    }

    private var releaseWatchdog: Timer?

    private func setupCGEventTap(hasAccessibility: Bool) -> Bool {
        let mask = isModifierOnly
            ? (1 << CGEventType.flagsChanged.rawValue)
            : (1 << CGEventType.flagsChanged.rawValue) |
              (1 << CGEventType.keyDown.rawValue) |
              (1 << CGEventType.keyUp.rawValue)

        let callback: CGEventTapCallBack = { (proxy, type, event, refcon) -> Unmanaged<CGEvent>? in
            guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
            let manager = Unmanaged<HotkeyManager>.fromOpaque(refcon).takeUnretainedValue()

            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap = manager.eventTap {
                    CGEvent.tapEnable(tap: tap, enable: true)
                }
                return Unmanaged.passUnretained(event)
            }

            manager.handleCGEvent(event, type: type)
            return Unmanaged.passUnretained(event)
        }

        let refcon = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: hasAccessibility ? .defaultTap : .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: callback,
            userInfo: refcon
        ) else {
            return false
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        self.eventTap = tap
        self.runLoopSource = source
        self.eventTapHadAccessibility = hasAccessibility
        return true
    }

    private func handleCGEvent(_ event: CGEvent, type: CGEventType) {
        let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
        let flags = event.flags

        if isModifierOnly {
            guard type == .flagsChanged else { return }

            // Globe/Fn can report a different virtual key code on some
            // keyboards. Its modifier flag is the reliable state transition.
            guard combination.matchesModifierEvent(keyCode: keyCode) else { return }

            let isTargetActive = combination.modifierIsPressed(flags: flags.rawValue)

            if isTargetActive {
                fireDown()
            } else {
                fireUp()
            }
        } else {
            let targetKey = UInt16(combination.keyCode)
            let hasTargetModifier: Bool = {
                switch combination.type {
                case .optionSpace: return flags.contains(.maskAlternate)
                case .commandSpace: return flags.contains(.maskCommand)
                default: return false
                }
            }()

            if type == .keyDown && keyCode == targetKey && hasTargetModifier {
                fireDown()
            } else if (type == .keyUp && keyCode == targetKey) || (isKeyDown && !hasTargetModifier) {
                fireUp()
            }
        }
    }

    private func isPhysicalModifierDown() -> Bool {
        let currentFlags = CGEventSource.flagsState(.combinedSessionState)
        switch combination.type {
        case .leftControl:
            return CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(combination.keyCode))
        case .fn:
            return currentFlags.contains(.maskSecondaryFn)
        case .leftOption, .rightOption:
            return CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(combination.keyCode))
        case .optionSpace:
            return currentFlags.contains(.maskAlternate)
        case .commandSpace:
            return currentFlags.contains(.maskCommand)
        }
    }

    private func startReleaseWatchdog() {
        releaseWatchdog?.invalidate()
        let timer = Timer(timeInterval: 0.04, repeats: true) { [weak self] timer in
            guard let self else {
                timer.invalidate()
                return
            }
            if !self.isPhysicalModifierDown() {
                timer.invalidate()
                self.releaseWatchdog = nil
                self.fireUp()
            }
        }
        releaseWatchdog = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func stopReleaseWatchdog() {
        releaseWatchdog?.invalidate()
        releaseWatchdog = nil
    }

    private func setupNSEventMonitors() {
        let targetKey = UInt16(combination.keyCode)
        let targetMod = combination.modifierFlag

        if isModifierOnly {
            let isFlagActive: (NSEvent) -> Bool = { [weak self] event in
                guard let self else { return false }
                return self.combination.modifierIsPressed(flags: UInt64(event.modifierFlags.rawValue))
            }

            globalFlags = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] e in
                guard let self, self.combination.matchesModifierEvent(keyCode: e.keyCode) else { return }
                isFlagActive(e) ? self.fireDown() : self.fireUp()
            }

            localFlags = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] e in
                guard let self, self.combination.matchesModifierEvent(keyCode: e.keyCode) else { return e }
                isFlagActive(e) ? self.fireDown() : self.fireUp()
                return e
            }
        } else {
            globalKeyDown = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] e in
                let mods = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
                if e.keyCode == targetKey, mods.contains(targetMod) { self?.fireDown() }
            }
            globalKeyUp = NSEvent.addGlobalMonitorForEvents(matching: .keyUp) { [weak self] e in
                if e.keyCode == targetKey, self?.isKeyDown == true { self?.fireUp() }
            }
            globalFlags = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] e in
                guard let self, self.isKeyDown else { return }
                let mods = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
                if !mods.contains(targetMod) { self.fireUp() }
            }

            localKeyDown = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] e in
                guard let self else { return e }
                let mods = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
                if e.keyCode == targetKey, mods.contains(targetMod) {
                    self.fireDown()
                    return nil
                }
                return e
            }
            localKeyUp = NSEvent.addLocalMonitorForEvents(matching: .keyUp) { [weak self] e in
                guard let self else { return e }
                if e.keyCode == targetKey, self.isKeyDown {
                    self.fireUp()
                    return nil
                }
                return e
            }
            localFlags = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] e in
                guard let self, self.isKeyDown else { return e }
                let mods = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
                if !mods.contains(targetMod) { self.fireUp() }
                return e
            }
        }
    }

    private func fireDown() {
        guard !isKeyDown else { return }
        isKeyDown = true
        if isModifierOnly && combination.type != .fn {
            DispatchQueue.main.async { [weak self] in
                self?.startReleaseWatchdog()
            }
        }
        DispatchQueue.main.async { [weak self] in self?.onKeyDown?() }
    }

    private func fireUp() {
        guard isKeyDown else { return }
        isKeyDown = false
        DispatchQueue.main.async { [weak self] in
            self?.stopReleaseWatchdog()
            self?.onKeyUp?()
        }
    }

    public func resetState() {
        isKeyDown = false
        DispatchQueue.main.async { [weak self] in
            self?.stopReleaseWatchdog()
        }
    }

    public func unregister() {
        registrationRetry?.invalidate()
        registrationRetry = nil
        stopReleaseWatchdog()
        removeCGEventTap()
        removeNSEventMonitors()
        onKeyDown = nil
        onKeyUp = nil
        isKeyDown = false
    }

    private func removeCGEventTap() {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            if let source = runLoopSource {
                CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
            }
            CFMachPortInvalidate(tap)
            eventTap = nil
            runLoopSource = nil
        }
        eventTapHadAccessibility = false
    }

    private func removeNSEventMonitors() {
        [globalKeyDown, globalKeyUp, globalFlags, localKeyDown, localKeyUp, localFlags].forEach {
            if let m = $0 { NSEvent.removeMonitor(m) }
        }
        globalKeyDown = nil; globalKeyUp = nil; globalFlags = nil
        localKeyDown = nil; localKeyUp = nil; localFlags = nil
    }
}
