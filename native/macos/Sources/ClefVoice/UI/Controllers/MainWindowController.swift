import AppKit
import WebKit

/// Main application window: renders the React UI (Dashboard, History, Preferences) in a WKWebView and
/// bridges it to the native layer (AppViewModel → Go core engine).
public final class MainWindowController: NSWindowController, WKScriptMessageHandler {

    public static let shared = MainWindowController()

    private var webView: WKWebView!

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

        // Native draggable titlebar overlay (x: 80 past traffic lights, height 48)
        let dragBar = DraggableTitlebarView(frame: NSRect(x: 80, y: 640 - 48, width: 920 - 80 - 40, height: 48))
        dragBar.autoresizingMask = [.width, .minYMargin]
        containerView.addSubview(dragBar, positioned: .above, relativeTo: webView)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 920, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "ClefVoice"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.contentView = containerView
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 780, height: 540)
        window.center()

        super.init(window: window)

        self.webView = webView
        userContent.add(self, name: "clefVoice")
        userContent.addUserScript(
            WKUserScript(source: Self.bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
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
        let json = Self.jsonString(payload)
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
        guard message.name == "clefVoice",
              let body = message.body as? String,
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = json["id"] as? NSNumber,
              let method = json["method"] as? String
        else { return }

        let params = json["params"] as? [String: Any] ?? [:]

        let result = MainActor.assumeIsolated {
            Self.handle(method: method, params: params)
        }

        let script = "window.__clefVoiceResolve(\(id.intValue), \(Self.jsonString(result)));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: - Bridge handlers

    @MainActor
    private static func handle(method: String, params: [String: Any]) -> Any? {
        let vm = AppViewModel.shared
        switch method {
        case "getState":
            return ["status": vm.status.rawValue, "message": vm.statusMessage, "progress": vm.downloadProgress]
        case "getSettings":
            return settingsJSON(vm)
        case "updateSettings":
            if let settings = params["settings"] as? [String: Any] {
                applySettings(settings, vm: vm)
            }
            return nil
        case "getLanguages":
            return WhisperLanguage.allCases.map { ["code": $0.rawValue, "name": $0.displayName] }
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
        case "requestInputMonitoring":
            vm.requestInputMonitoringPermission()
            return nil
        case "loadModel":
            if let size = params["size"] as? String, let model = WhisperModelSize(rawValue: size) {
                vm.session.loadModel(model: model.rawValue)
            }
            return nil
        case "getStats":
            vm.requestStats()
            return nil
        case "getHistory":
            vm.requestHistory()
            return nil
        case "clearHistory":
            vm.clearHistory()
            return nil
        case "deleteHistoryItem":
            if let id = params["id"] as? String {
                vm.deleteHistoryEntry(id: id)
            }
            return nil
        case "toggleDictation":
            vm.toggleDictation()
            return nil
        default:
            return nil
        }
    }

    @MainActor
    private static func settingsJSON(_ vm: AppViewModel) -> [String: Any] {
        return vm.settingsJSON()
    }

    @MainActor
    private static func applySettings(_ json: [String: Any], vm: AppViewModel) {
        var patch: [String: Any] = [:]
        if let langs = json["selectedLanguages"] as? [String] { patch["languages"] = langs }
        if let model = json["modelSize"] as? String { patch["model"] = model }
        if let raw = json["hotkey"] as? String, let hotkey = HotkeyType(persistedValue: raw) {
            vm.selectedHotkey = hotkey
        }
        if let vad = json["vadEnabled"] as? Bool { patch["vad_enabled"] = vad }
        if let th = (json["vadThreshold"] as? NSNumber)?.floatValue { patch["vad_threshold"] = th }
        if let autoStop = json["autoStopEnabled"] as? Bool { patch["auto_stop_enabled"] = autoStop }
        if let secs = (json["autoStopSeconds"] as? NSNumber)?.doubleValue { patch["auto_stop_seconds"] = secs }
        if let remove = json["removeFillerWords"] as? Bool { patch["remove_filler_words"] = remove }
        if let cap = json["autoCapitalize"] as? Bool { patch["auto_capitalize"] = cap }
        if let vocab = json["customVocabulary"] as? [String] { patch["custom_vocabulary"] = vocab }

        if !patch.isEmpty { vm.updateEngineConfig(patch: patch) }
    }

    // MARK: - JSON helpers

    private static func jsonString(_ value: Any?) -> String {
        guard let value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let string = String(data: data, encoding: .utf8) else {
            return "null"
        }
        return string
    }

    private static func quote(_ string: String) -> String {
        let escaped = string.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    // MARK: - Injected bridge script

    private static let bridgeJS = """
    (function () {
      var pending = {};
      var seq = 0;
      var listeners = {};

      window.clefVoice = {
        call: function (method, params) {
          return new Promise(function (resolve) {
            var id = ++seq;
            pending[id] = resolve;
            try {
              window.webkit.messageHandlers.clefVoice.postMessage(
                JSON.stringify({ id: id, method: method, params: params || {} })
              );
            } catch (e) {
              delete pending[id];
              resolve(null);
            }
          });
        },
        on: function (type, cb) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(cb);
          return function () {
            listeners[type] = (listeners[type] || []).filter(function (f) { return f !== cb; });
          };
        }
      };

      window.__clefVoiceResolve = function (id, result) {
        var r = pending[id];
        if (r) { delete pending[id]; r(result); }
      };
      window.__clefVoiceEmit = function (type, payload) {
        (listeners[type] || []).forEach(function (cb) { cb(payload); });
      };
    })();
    """
}

/// Transparent view that delegates mouse drag events to the parent NSWindow for native window moving.
final class DraggableTitlebarView: NSView {
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}
