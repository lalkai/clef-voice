import AppKit
import WebKit

/// Main application window: renders the React UI (Dashboard, History, Preferences) in a WKWebView and
/// bridges it to the native layer (AppViewModel → Go core engine).
public final class MainWindowController: NSWindowController, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {

    public static let shared = MainWindowController()

    private var webView: WKWebView!
    private var shortcutMonitor: Any?
    private var shortcutAlert: NSAlert?

    private init() {
        let userContent = WKUserContentController()

        let config = WKWebViewConfiguration()
        config.userContentController = userContent

        let webView = WKWebView(frame: .zero, configuration: config)
        if webView.responds(to: Selector(("setDrawsBackground:"))) {
            webView.setValue(false, forKey: "drawsBackground")
        }

        let containerView = NSView(frame: NSRect(x: 0, y: 0, width: 920, height: 640))
        containerView.autoresizingMask = [.width, .height]

        webView.frame = containerView.bounds
        webView.autoresizingMask = [.width, .height]
        containerView.addSubview(webView)

        let dragBar = DraggableTitlebarView(containerSize: containerView.bounds.size)
        containerView.addSubview(dragBar, positioned: .above, relativeTo: webView)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 920, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = AppConfig.name
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.contentView = containerView
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 780, height: 540)
        window.center()

        super.init(window: window)

        window.delegate = self
        self.webView = webView
        webView.navigationDelegate = self
        userContent.add(self, name: "clefVoice")
        userContent.addUserScript(
            WKUserScript(source: WebBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        loadContent()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    public func showSettings(tab: String? = nil) {
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if let tab = tab {
            push("navigateTab", ["tab": tab])
        }
    }

    /// Push a live event to the web UI (status / transcription / model progress / permissions).
    public func push(_ type: String, _ payload: [String: Any]) {
        guard let webView else { return }
        let json = WebBridge.jsonString(payload)
        let script = "window.__clefVoiceEmit(\(Self.quote(type)), \(json));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: - Loading

    private func loadContent() {
        if ProcessInfo.processInfo.environment["CLEF_DEV"] == "1",
           let url = URL(string: "http://localhost:1420") {
            webView.load(URLRequest(url: url))
            return
        }

        guard let resourceURL = Bundle.main.resourceURL else { return }
        let webDir = resourceURL.appendingPathComponent("web")
        let index = webDir.appendingPathComponent("index.html")

        if FileManager.default.fileExists(atPath: index.path) {
            webView.loadFileURL(index, allowingReadAccessTo: webDir)
        } else {
            let html = """
            <html><body style="background:#1e1e24;color:#fff;font-family:-apple-system;padding:24px">
            <h2>ClefVoice UI not found</h2>
            <p>Build the web UI with <code>npm --prefix app run build</code>, then rebuild the app.</p>
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
    }

    // MARK: - WKScriptMessageHandler

    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.webView === webView,
              isTrustedPage(message.frameInfo.request.url, isMainFrame: message.frameInfo.isMainFrame),
              message.name == "clefVoice",
              let body = message.body as? String,
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = json["id"] as? NSNumber,
              let method = json["method"] as? String
        else { return }

        let params = json["params"] as? [String: Any] ?? [:]

        let page = json["page"] as? String ?? ""
        func reply(_ script: String) {
            webView.evaluateJavaScript(WebBridge.pageScript(script, page: page))
        }
        if method == "recordHotkey" {
            MainActor.assumeIsolated { recordHotkey(id: id.intValue, reply: reply) }
            return
        }
        MainActor.assumeIsolated {
            do {
                try Self.validateMethod(method)
                if let command = try Self.engineCommand(method: method, params: params) {
                    AppViewModel.shared.session.engine.request(command, accepted: {
                        reply("window.__clefVoiceAccepted(\(id.intValue));")
                    }, completion: { result in
                        switch result {
                        case .success(let value):
                            do { reply(WebBridge.resolveScript(id: id.intValue, result: try Self.engineResponse(method: method, value: value))) }
                            catch { reply(WebBridge.rejectScript(id: id.intValue, message: error.localizedDescription)) }
                        case .failure(let error): reply(WebBridge.rejectScript(id: id.intValue, message: error.localizedDescription))
                        }
                    })
                } else {
                    reply(WebBridge.resolveScript(id: id.intValue, result: try Self.handle(method: method, params: params)))
                }
            } catch { reply(WebBridge.rejectScript(id: id.intValue, message: error.localizedDescription)) }
        }
    }


    @MainActor
    private func recordHotkey(id: Int, reply: @escaping (String) -> Void) {
        guard shortcutAlert == nil, let window, !AppViewModel.shared.session.isRecording,
              !AppViewModel.shared.session.isStartingCapture,
              AppViewModel.shared.status != .transcribing else {
            reply(WebBridge.resolveScript(id: id, result: nil))
            return
        }
        let alert = NSAlert()
        alert.messageText = "Record shortcut"
        alert.informativeText = "Press a modifier key, or hold modifiers and press another key. Escape cancels."
        alert.addButton(withTitle: "Cancel")
        shortcutAlert = alert
        let manager = HotkeyManager.shared
        manager.isRecordingShortcut = true
        manager.resetState()
        var candidate: HotkeyType?
        var result: HotkeyType?
        var pendingKey: UInt16?
        shortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { event in
            guard event.window === alert.window else { return event }
            if event.type == .keyUp {
                if event.keyCode == pendingKey { window.endSheet(alert.window) }
                return nil
            }
            if event.type == .keyDown {
                if event.keyCode == 53 { window.endSheet(alert.window); return nil }
                if let recorded = HotkeyType.recorded(keyCode: event.keyCode, flags: event.modifierFlags) {
                    result = recorded
                    pendingKey = event.keyCode
                } else {
                    alert.informativeText = "Use a modifier key or a modifier + key combination. Choose a shortcut other than system navigation or Quit."
                }
                return nil
            }
            let flags = event.modifierFlags.intersection([.command, .control, .option, .shift, .function])
            if flags.isEmpty, pendingKey == nil, let candidate {
                result = candidate
                window.endSheet(alert.window)
            } else {
                candidate = HotkeyType.recorded(keyCode: event.keyCode, flags: event.modifierFlags)
            }
            return event
        }
        alert.beginSheetModal(for: window) { [weak self] _ in
            guard let self else { return }
            if let monitor = self.shortcutMonitor { NSEvent.removeMonitor(monitor) }
            self.shortcutMonitor = nil
            self.shortcutAlert = nil
            manager.isRecordingShortcut = false
            manager.resetState()
            let payload = result.map { ["value": $0.rawValue, "label": $0.displayName] }
            reply(WebBridge.resolveScript(id: id, result: payload))
        }
    }

    // MARK: - Bridge handlers

    @MainActor
    private static func handle(method: String, params: [String: Any]) throws -> Any? {
        let vm = AppViewModel.shared
        switch method {
        case "retryEngine":
            vm.session.engine.retry()
            return true
        case "getSetupState":
            return ["completed": SetupState.completed()]
        case "completeSetup":
            vm.checkPermissions()
            return SetupState.complete(permissionsGranted: vm.areAllPermissionsGranted, status: vm.status, inventory: vm.modelInventory)
        case "copyText":
            guard let text = params["text"] as? String else { return false }
            NSPasteboard.general.clearContents()
            return NSPasteboard.general.setString(text, forType: .string)
        case "getState":
            return ["status": vm.status.rawValue, "message": vm.statusMessage, "progress": vm.downloadProgress]
        case "getModels":
            vm.requestModels()
            return vm.modelInventory
        case "getModelSizes":
            return WhisperModelSize.allCases.map { ["value": $0.rawValue, "label": $0.displayName] }
        case "getHotkeys":
            return HotkeyType.allCases.map { ["value": $0.rawValue, "label": $0.displayName] }
        case "checkPermissions":
            vm.checkPermissions()
            return [
                "microphone": vm.isMicrophoneGranted,
                "accessibility": vm.isAccessibilityGranted,
                "inputMonitoring": vm.isInputMonitoringGranted,
            ]
        case "requestAccessibility":
            vm.requestAccessibilityPermission()
            return nil
        case "requestMicrophone":
            vm.requestMicrophonePermission()
            return nil
        case "getStats":
            vm.requestStats()
            return nil
        case "getHistory":
            vm.requestHistory()
            return nil
        case "toggleDictation":
            vm.toggleDictation()
            return nil
        default:
            throw EngineFailure("Unknown native method: \(method)")
        }
    }

    public func windowWillClose(_ notification: Notification) {
        if let alert = shortcutAlert, let window { window.endSheet(alert.window) }
    }

    private func isTrustedPage(_ url: URL?, isMainFrame: Bool) -> Bool {
        WebBridge.isTrustedPage(url, isMainFrame: isMainFrame,
            webRoot: Bundle.main.resourceURL?.appendingPathComponent("web"),
            development: ProcessInfo.processInfo.environment["CLEF_DEV"] == "1")
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let trusted = isTrustedPage(navigationAction.request.url, isMainFrame: navigationAction.targetFrame?.isMainFrame == true)
        decisionHandler(trusted || navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
    }

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if let alert = shortcutAlert, let window { window.endSheet(alert.window) }
    }

    static func validateMethod(_ method: String) throws {
        let methods: Set<String> = ["getSetupState", "completeSetup", "copyText", "getState", "getSettings", "updateSettings", "getLanguages", "getModels", "downloadModel", "deleteModel", "getModelSizes", "getHotkeys", "checkPermissions", "requestAccessibility", "requestMicrophone", "loadModel", "getStats", "getHistory", "clearHistory", "deleteHistoryItem", "toggleDictation", "setHistoryFavorite", "retryEngine", "cancelDownload", "recordHotkey"]
        guard methods.contains(method) else { throw EngineFailure("Unknown native method: \(method)") }
    }

    static func engineCommand(method: String, params: [String: Any]) throws -> [String: Any]? {
        switch method {
        case "getSettings": return ["cmd": "get_config"]
        case "getLanguages": return ["cmd": "get_languages"]
        case "updateSettings":
            guard let settings = params["settings"] as? [String: Any] else { throw EngineFailure("Missing settings.") }
            return ["cmd": "set_config", "config": engineConfigPatch(settings)]
        case "downloadModel", "loadModel", "deleteModel":
            guard let model = params["size"] as? String else { throw EngineFailure("Missing model.") }
            return ["cmd": method == "downloadModel" ? "download_model" : method == "loadModel" ? "load_model" : "delete_model", "model": model]
        case "cancelDownload": return ["cmd": "cancel_download"]
        case "clearHistory": return ["cmd": "clear_history"]
        case "deleteHistoryItem", "setHistoryFavorite":
            guard let id = params["id"] as? String else { throw EngineFailure("Missing history ID.") }
            var command: [String: Any] = ["cmd": method == "deleteHistoryItem" ? "delete_history" : "set_history_favorite", "id": id]
            if method == "setHistoryFavorite" {
                guard let favorite = params["favorite"] as? Bool else { throw EngineFailure("Missing favorite value.") }
                command["favorite"] = favorite
            }
            return command
        default: return nil
        }
    }

    static func engineResponse(method: String, value: Any?) throws -> Any? {
        guard method == "getSettings" else { return value }
        guard let config = value as? [String: Any] else { throw EngineFailure("Missing engine settings.") }
        return try SettingsPresentation.webJSON(config)
    }

    static func engineConfigPatch(_ json: [String: Any]) -> [String: Any] {
        SettingsPresentation.enginePatch(json)
    }

    // MARK: - JSON helpers

    private static func quote(_ string: String) -> String {
        let escaped = string.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }
}

/// Transparent view that delegates mouse drag events to the parent NSWindow for native window moving.
final class DraggableTitlebarView: NSView {
    init(containerSize: NSSize) {
        super.init(frame: NSRect(x: 80, y: containerSize.height - 28, width: containerSize.width - 120, height: 28))
        autoresizingMask = [.width, .minYMargin]
    }

    required init?(coder: NSCoder) { super.init(coder: coder) }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}
