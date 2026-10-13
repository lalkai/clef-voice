import Foundation
import Combine
import AppKit
import AVFoundation

@MainActor
public final class AppViewModel: ObservableObject {
    public static let shared = AppViewModel()

    let session = DictationSession()

    @Published var status: AppStatus = .loading
    @Published var statusMessage = "Preparing model..."
    @Published var lastTranscribedText = ""
    @Published var lastWPM: Double = 0
    @Published var audioLevel: Float = 0
    @Published var isAccessibilityGranted = false
    @Published var isMicrophoneGranted = false
    @Published var isInputMonitoringGranted = false

    var areAllPermissionsGranted: Bool {
        isAccessibilityGranted && isMicrophoneGranted
    }

    @Published var transcriptionHistory: [TranscriptionEntry] = []
    @Published private(set) var modelInventory: [String: Any] = ["items": [], "busy": true, "connected": true, "generation": 0]
    var hasActiveModel: Bool {
        let items = modelInventory["items"] as? [[String: Any]] ?? []
        return items.contains { $0["active"] as? Bool == true && $0["downloaded"] as? Bool == true && $0["status"] as? String == "downloaded" }
    }

    public private(set) var latestEngineConfig: [String: Any] = [:]
    private var isUpdatingFromEngine = false

    @Published var selectedLanguages: Set<WhisperLanguage> = [] {
        didSet {
            guard !isUpdatingFromEngine else { return }
            updateEngineConfig(patch: ["languages": selectedLanguages.map(\.rawValue).sorted()])
        }
    }

    @Published var selectedModelSize: WhisperModelSize = AppConfig.defaultModel {
        didSet {
            guard !isUpdatingFromEngine else { return }
            session.loadModel(model: selectedModelSize.rawValue)
        }
    }

    @Published var selectedHotkey: HotkeyType = .launchSelection() {
        didSet {
            if status == .idle { statusMessage = "Hold \(selectedHotkey.shortName) to dictate" }
            if session.selectedHotkey != selectedHotkey {
                session.selectedHotkey = selectedHotkey
                session.setupHotkey()
            }
            guard !isUpdatingFromEngine else { return }
            updateEngineConfig(patch: ["hotkey": selectedHotkey.rawValue])
        }
    }

    @Published var isVADEnabled = AppConfig.defaultVADEnabled {
        didSet {
            guard !isUpdatingFromEngine else { return }
            updateEngineConfig(patch: ["vad_enabled": isVADEnabled])
        }
    }
    @Published var isAutoStopEnabled = AppConfig.defaultAutoStopEnabled {
        didSet {
            guard !isUpdatingFromEngine else { return }
            updateEngineConfig(patch: ["auto_stop_enabled": isAutoStopEnabled])
        }
    }
    @Published var autoStopSeconds: Double = AppConfig.defaultAutoStopSeconds {
        didSet {
            guard !isUpdatingFromEngine else { return }
            updateEngineConfig(patch: ["auto_stop_seconds": autoStopSeconds])
        }
    }
    @Published var vadSensitivity: Double = AppConfig.defaultVadThreshold {
        didSet {
            guard !isUpdatingFromEngine else { return }
            updateEngineConfig(patch: ["vad_threshold": vadSensitivity])
        }
    }

    @Published var downloadProgress: Double = 0
    @Published var isDownloadingModel = false
    @Published var isModelLoading = false


    @Published var isRecording: Bool = false
    @Published var isWaitingForModel: Bool = false
    @Published var isStartingCapture: Bool = false

    private var permissionAlert: NSAlert?
    private var isRequestingMicrophonePermission = false
    private var cancellables = Set<AnyCancellable>()

    public init() {
        bindSession()
        checkPermissions()

        HUDWindowController.shared.setup(viewModel: self)

        requestConfig()
        requestModels()
        requestHistory()
        requestStats()
    }

    private func bindSession() {
        session.$isRecording
            .receive(on: DispatchQueue.main)
            .sink { [weak self] recording in
                self?.isRecording = recording
            }
            .store(in: &cancellables)

        session.$isWaitingForModel
            .receive(on: DispatchQueue.main)
            .sink { [weak self] waiting in
                guard let self else { return }
                self.isWaitingForModel = waiting
                HUDWindowController.shared.updateHUD(viewModel: self)
            }
            .store(in: &cancellables)

        session.$isStartingCapture
            .receive(on: DispatchQueue.main)
            .sink { [weak self] starting in
                guard let self else { return }
                self.isStartingCapture = starting
                HUDWindowController.shared.updateHUD(viewModel: self)
            }
            .store(in: &cancellables)

        session.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                switch event {
                case .connection(let connected, let generation, let message):
                    self.modelInventory = ["items": [], "busy": false, "connected": connected, "generation": generation]
                    MainWindowController.shared.push("connection", ["connected": connected, "generation": generation, "message": message])
                    MainWindowController.shared.push("models", self.modelInventory)
                case .notice(let message):
                    MainWindowController.shared.push("notice", ["message": message, "text": self.lastTranscribedText])
                case .statusChanged(let s, let msg):
                    self.status = s
                    self.statusMessage = msg
                    self.isModelLoading = s == .loading
                    self.isDownloadingModel = s == .downloading
                    if s == .loading { self.downloadProgress = 0 }
                    HUDWindowController.shared.updateHUD(viewModel: self)
                    MainWindowController.shared.push("status", ["status": s.rawValue, "message": msg])

                case .finalTranscription(let text, let wpm):
                    self.lastTranscribedText = text
                    self.lastWPM = wpm
                    let lang = self.selectedLanguages.isEmpty ? "Auto"
                        : self.selectedLanguages.map(\.rawValue).sorted().joined(separator: ",")

                    self.requestHistory()
                    self.requestStats()

                    HUDWindowController.shared.updateHUD(viewModel: self)
                    MainWindowController.shared.push("transcribed", [
                        "text": text, "wpm": wpm, "language": lang,
                        "timestamp": Date().timeIntervalSince1970,
                    ])

                case .audioLevelUpdated(let lvl):
                    self.audioLevel = lvl

                case .modelProgress(_, let progress, let downloading):
                    self.downloadProgress = progress
                    self.isDownloadingModel = downloading
                    MainWindowController.shared.push("modelProgress", [
                        "progress": progress, "downloading": downloading,
                    ])

                case .history(let items):
                    if let arr = items as? [[String: Any]] {
                        self.transcriptionHistory = arr.compactMap { dict in
                            guard let text = dict["text"] as? String,
                                  let lang = dict["language"] as? String
                            else { return nil }
                            let id = dict["id"] as? String ?? UUID().uuidString
                            let wpm = dict["wpm"] as? Double ?? 0
                            return TranscriptionEntry(id: id, text: text, timestamp: TranscriptionEntry.parseTimestamp(dict["createdAt"] as? String) ?? Date(), language: lang, wpm: wpm)
                        }
                    }
                    MainWindowController.shared.push("history", ["items": items])

                case .stats(let stats):
                    MainWindowController.shared.push("stats", stats)

                case .models(let snapshot):
                    var snapshot = snapshot
                    snapshot["connected"] = self.modelInventory["connected"] ?? true
                    snapshot["generation"] = self.modelInventory["generation"] ?? 0
                    self.modelInventory = snapshot
                    MainWindowController.shared.push("models", snapshot)

                case .config(let cfg):
                    self.applyEngineConfig(cfg)
                }
            }
            .store(in: &cancellables)
    }

    func requestModels() { session.engine.send(["cmd": "get_models"]) }
    func requestConfig() { session.engine.send(["cmd": "get_config"]) }
    func requestHistory() { session.engine.send(["cmd": "get_history"]) }
    func requestStats() { session.engine.send(["cmd": "get_stats"]) }
    func clearHistory() {
        session.engine.send(["cmd": "clear_history"])
    }

    func applyEngineConfig(_ cfg: [String: Any]) {
        self.latestEngineConfig = cfg
        self.isUpdatingFromEngine = true
        defer { self.isUpdatingFromEngine = false }

        if let langs = cfg["languages"] as? [String] {
            let set = Set(langs.compactMap(WhisperLanguage.init(rawValue:)))
            self.selectedLanguages = set
        }
        if let raw = cfg["model"] as? String, let size = WhisperModelSize(rawValue: raw) {
            self.selectedModelSize = size
        }
        if let raw = cfg["hotkey"] as? String, let hk = HotkeyType(persistedValue: raw) {
            self.selectedHotkey = hk
        }
        if let vad = cfg["vad_enabled"] as? Bool {
            self.isVADEnabled = vad
        }
        if let th = (cfg["vad_threshold"] as? NSNumber)?.doubleValue {
            self.vadSensitivity = th
        }
        if let autoStop = cfg["auto_stop_enabled"] as? Bool {
            self.isAutoStopEnabled = autoStop
        }
        if let secs = (cfg["auto_stop_seconds"] as? NSNumber)?.doubleValue {
            self.autoStopSeconds = secs
        }
        MainWindowController.shared.push("settings", settingsJSON())
    }

    func updateEngineConfig(patch: [String: Any]) {
        // The engine merges patches into its current config. Sending a cached full
        // config here can undo another change whose acknowledgement is still pending.
        session.engine.send(["cmd": "set_config", "config": patch])
    }

    func settingsJSON() -> [String: Any] {
        let customVocab = latestEngineConfig["custom_vocabulary"] as? [String] ?? AppConfig.defaultCustomVocabulary
        return [
            "selectedLanguages": selectedLanguages.map(\.rawValue).sorted(),
            "modelSize": selectedModelSize.rawValue,
            "hotkey": selectedHotkey.rawValue,
            "hotkeyLabel": selectedHotkey.displayName,
            "vadEnabled": isVADEnabled,
            "vadThreshold": NSNumber(value: vadSensitivity),
            "autoStopEnabled": isAutoStopEnabled,
            "autoStopSeconds": NSNumber(value: autoStopSeconds),
            "removeFillerWords": latestEngineConfig["remove_filler_words"] as? Bool ?? AppConfig.defaultRemoveFiller,
            "autoCapitalize": latestEngineConfig["auto_capitalize"] as? Bool ?? AppConfig.defaultAutoCapitalize,
            "customVocabulary": customVocab,
        ]
    }

    func copyHistoryEntry(_ entry: TranscriptionEntry) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(entry.text, forType: .string)
    }

    func deleteHistoryEntry(_ entry: TranscriptionEntry) {
        deleteHistoryEntry(id: entry.id)
    }

    func deleteHistoryEntry(id: String) {
        session.engine.send(["cmd": "delete_history", "id": id])
        // The engine emits complete history items and updated stats after deletion.
    }

    func toggleDictation() { session.toggleDictation() }

    func checkPermissions() {
        isAccessibilityGranted = TextInserter.shared.isAccessibilityGranted()
        isInputMonitoringGranted = CGPreflightListenEventAccess()
        session.hotkeyManager.refreshRegistration()
        isMicrophoneGranted = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        pushPermissions()
    }

    func requestMicrophonePermission() {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            checkPermissions()
        case .notDetermined:
            guard !isRequestingMicrophonePermission else { return }
            isRequestingMicrophonePermission = true
            Task {
                _ = await AVCaptureDevice.requestAccess(for: .audio)
                isRequestingMicrophonePermission = false
                checkPermissions()
            }
        case .denied, .restricted:
            promptToOpenPrivacySettings(
                title: "Microphone Access",
                message: "Allow ClefVoice to use the microphone in System Settings, then return to the app.",
                pane: "Privacy_Microphone"
            )
        @unknown default:
            checkPermissions()
        }
    }

    func requestAccessibilityPermission() {
        guard !TextInserter.shared.isAccessibilityGranted() else { checkPermissions(); return }
        promptToOpenPrivacySettings(
            title: "Accessibility Access",
            message: "Allow ClefVoice in Accessibility settings so it can insert dictated text into other apps.",
            pane: "Privacy_Accessibility"
        )
    }

    private func promptToOpenPrivacySettings(title: String, message: String, pane: String) {
        guard permissionAlert == nil,
              let window = MainWindowController.shared.window,
              let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")
        else { return }

        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Not Now")
        permissionAlert = alert
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            self.permissionAlert = nil
            if response == .alertFirstButtonReturn {
                NSWorkspace.shared.open(url)
            }
            self.checkPermissions()
        }
    }

    private func pushPermissions() {
        MainWindowController.shared.push("permissions", [
            "microphone": isMicrophoneGranted,
            "accessibility": isAccessibilityGranted,
            "inputMonitoring": isInputMonitoringGranted,
        ])
    }
}
