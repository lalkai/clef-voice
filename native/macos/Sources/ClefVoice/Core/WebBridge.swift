import Foundation

enum WebBridge {
    static func isTrustedPage(_ url: URL?, isMainFrame: Bool, webRoot: URL?, development: Bool) -> Bool {
        guard isMainFrame, let url else { return false }
        if development, url.scheme == "http", url.host == "localhost", url.port == 1420,
           url.user == nil, url.password == nil { return true }
        guard url.isFileURL, let webRoot else { return false }
        return url.standardizedFileURL.resolvingSymlinksInPath().path ==
            webRoot.appendingPathComponent("index.html").standardizedFileURL.resolvingSymlinksInPath().path
    }

    static func jsonString(_ value: Any?) -> String {
        guard let value,
              let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed),
              let string = String(data: data, encoding: .utf8) else {
            return "null"
        }
        return string
    }

    static func resolveScript(id: Int, result: Any?) -> String {
        "window.__clefVoiceResolve(\(id), \(jsonString(result)));"
    }

    static func rejectScript(id: Int, message: String) -> String {
        "window.__clefVoiceReject(\(id), \(jsonString(message)));"
    }

    static func pageScript(_ script: String, page: String) -> String {
        "if(window.__clefVoicePage === \(jsonString(page))) { \(script) }"
    }

    static let script = makeScript()

    static func makeScript(timeoutMilliseconds: Int = 10_000) -> String {
        """
    (function () {
      window.__clefVoicePage = String(Date.now()) + Math.random();
      var pending = {};
      var seq = 0;
      var listeners = {};

      window.clefVoice = {
        call: function (method, params) {
          return new Promise(function (resolve, reject) {
            var id = ++seq;
            var timer = null;
            var finish = function (error, result) {
              delete pending[id];
              if (timer !== null) clearTimeout(timer);
              if (error) reject(new Error(error)); else resolve(result);
            };
            finish.accepted = function () { if (timer !== null) clearTimeout(timer); timer = null; };
            pending[id] = finish;
            if (method !== "recordHotkey") {
              timer = setTimeout(function () { finish("Native request timed out. Please retry."); }, \(timeoutMilliseconds));
            }
            try {
              window.webkit.messageHandlers.clefVoice.postMessage(
                JSON.stringify({ id: id, page: window.__clefVoicePage, method: method, params: params || {} })
              );
            } catch (e) {
              finish(e.message || "Native transport unavailable.");
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
        if (r) r(null, result);
      };
      window.__clefVoiceReject = function (id, message) {
        var r = pending[id];
        if (r) r(message || "Native operation failed.");
      };
      window.__clefVoiceAccepted = function (id) {
        if (pending[id]) pending[id].accepted();
      };
      window.addEventListener("pagehide", function () {
        Object.keys(pending).forEach(function (id) { pending[id]("Page closed."); });
      });
      window.__clefVoiceEmit = function (type, payload) {
        (listeners[type] || []).forEach(function (cb) { cb(payload); });
      };
    })();
    """
    }
}
