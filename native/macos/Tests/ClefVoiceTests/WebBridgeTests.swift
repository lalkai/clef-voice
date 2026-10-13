import XCTest
import WebKit
import AppKit
@testable import ClefVoice

final class WebBridgeTests: XCTestCase {
    @MainActor
    func testTitlebarDoesNotInterceptSetupControlsAtMinimumWindowSize() {
        for size in [NSSize(width: 920, height: 640), NSSize(width: 780, height: 540)] {
            let container = NSView(frame: NSRect(origin: .zero, size: size))
            let content = NSView(frame: container.bounds)
            container.addSubview(content)
            let dragBar = DraggableTitlebarView(containerSize: size)
            container.addSubview(dragBar)
            XCTAssertTrue(container.hitTest(NSPoint(x: 400, y: size.height - 40)) === content,
                          "The old 48-point overlay intercepted the upper part of Setup buttons")
            XCTAssertTrue(container.hitTest(NSPoint(x: 400, y: size.height - 10)) === dragBar)
        }
    }

    func testBridgeOnlyTrustsBundledMainPageOrExplicitDevelopmentOrigin() {
        let root = URL(fileURLWithPath: "/test/ClefVoice.app/Contents/Resources/web")
        let index = root.appendingPathComponent("index.html")
        func trusted(_ url: URL?, main: Bool = true, dev: Bool = false) -> Bool {
            WebBridge.isTrustedPage(url, isMainFrame: main, webRoot: root, development: dev)
        }
        XCTAssertTrue(trusted(index))
        XCTAssertFalse(trusted(index, main: false))
        XCTAssertFalse(trusted(nil))
        XCTAssertFalse(trusted(root.appendingPathComponent("../index.html")))
        XCTAssertFalse(trusted(URL(fileURLWithPath: "/tmp/index.html")))
        XCTAssertFalse(trusted(URL(string: "https://example.com")))
        XCTAssertFalse(trusted(URL(string: "http://localhost:1420")))
        XCTAssertTrue(trusted(URL(string: "http://localhost:1420"), dev: true))
        XCTAssertFalse(trusted(URL(string: "http://localhost:1421"), dev: true))
        XCTAssertFalse(trusted(URL(string: "http://localhost.evil:1420"), dev: true))
        XCTAssertFalse(trusted(URL(string: "http://user@localhost:1420"), dev: true))
    }

    func testJSONValuesRoundTrip() throws {
        let text = "ภาษาไทย \"quoted\" \\ path\nnew line"
        let values: [Any] = [true, false, text, 42, 3.25, [text, "hello"], ["text": text, "ready": true], NSNull()]
        for value in values {
            let encoded = WebBridge.jsonString(value)
            let decoded = try JSONSerialization.jsonObject(with: Data(encoded.utf8), options: .fragmentsAllowed)
            XCTAssertEqual(decoded as? NSObject, value as? NSObject, "Failed for \(value)")
        }
        XCTAssertEqual(WebBridge.jsonString(nil), "null")
    }

    @MainActor
    func testBundledFileBridgeAllowsMainPageAndRejectsSubframes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let index = directory.appendingPathComponent("index.html")
        try "<!doctype html><html><body>Local bridge</body></html>".write(to: index, atomically: true, encoding: .utf8)
        let loaded = expectation(description: "local file loaded")
        let harness = BridgeHarness(loaded: loaded)
        harness.trustedRoot = directory
        let content = WKUserContentController()
        content.add(harness, name: "clefVoice")
        content.addUserScript(WKUserScript(source: WebBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = content
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        harness.webView = view
        view.navigationDelegate = harness
        defer { content.removeScriptMessageHandler(forName: "clefVoice"); view.stopLoading() }
        view.loadFileURL(index, allowingReadAccessTo: directory)
        await fulfillment(of: [loaded], timeout: 10)
        let finished = expectation(description: "main frame and child calls processed")
        let body = """
        const value = await window.clefVoice.call('copyText');
        const frame = document.createElement('iframe');
        frame.srcdoc = `<script>window.webkit.messageHandlers.clefVoice.postMessage(JSON.stringify({id:99,method:'copyText'}));</script>`;
        document.body.appendChild(frame);
        await new Promise(resolve => setTimeout(resolve, 100));
        return value;
        """
        view.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): XCTAssertEqual(value as? Bool, false)
            case .failure(let error): XCTFail(error.localizedDescription)
            }
            finished.fulfill()
        }
        await fulfillment(of: [finished], timeout: 10)
        XCTAssertEqual(harness.methods, ["copyText"])
        XCTAssertEqual(harness.blockedFrames, 1)
    }

    @MainActor
    func testBooleanResultsThroughInjectedBridge() async throws {
        let loaded = expectation(description: "WKWebView loaded")
        let harness = BridgeHarness(loaded: loaded)
        let content = WKUserContentController()
        content.add(harness, name: "clefVoice")
        content.addUserScript(WKUserScript(source: WebBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = content
        let webView = WKWebView(frame: .zero, configuration: configuration)
        harness.webView = webView
        webView.navigationDelegate = harness
        defer { content.removeScriptMessageHandler(forName: "clefVoice") }
        webView.loadHTMLString("<!doctype html><html><body>Bridge test</body></html>", baseURL: nil)
        await fulfillment(of: [loaded], timeout: 15)

        for method in ["completeSetup", "copyText"] {
            for success in [true, false] {
                harness.result = success
                let replied = expectation(description: "\(method): \(success)")
                webView.callAsyncJavaScript(
                    "return JSON.stringify(await window.clefVoice.call(method, {}));",
                    arguments: ["method": method], in: nil, in: .page
                ) { result in
                    switch result {
                    case .success(let value):
                        XCTAssertEqual(value as? String, success ? "true" : "false", "\(method): \(success)")
                    case .failure(let error):
                        XCTFail("Bridge call failed: \(error)")
                    }
                    replied.fulfill()
                }
                await fulfillment(of: [replied], timeout: 10)
            }
        }
        XCTAssertEqual(harness.methods, ["completeSetup", "completeSetup", "copyText", "copyText"])
    }
    @MainActor
    func testInjectedBridgeRejectsUnknownMethodAndTransportFailure() async throws {
        let unknown = try await exerciseBridge(mode: .normal, body: "return window.clefVoice.call('unknown').then(() => 'unexpected success', e => e.message);")
        XCTAssertTrue((unknown as? String)?.contains("Unknown native method") == true)
        let transport = try await exerciseBridge(mode: .normal, body: "window.webkit.messageHandlers.clefVoice.postMessage = function () { throw new Error('transport down'); }; return window.clefVoice.call('copyText').then(() => 'unexpected success', e => e.message);")
        XCTAssertEqual(transport as? String, "transport down")
    }

    @MainActor
    func testNoReplyTimesOutAndPageCloseCancelsUserInteraction() async throws {
        let timeout = try await exerciseBridge(mode: .drop, body: "return window.clefVoice.call('copyText').then(() => 'unexpected success', e => e.message);")
        XCTAssertTrue((timeout as? String)?.contains("timed out") == true)
        let closed = try await exerciseBridge(mode: .drop, body: "var p = window.clefVoice.call('recordHotkey'); window.dispatchEvent(new Event('pagehide')); return p.then(() => 'unexpected success', e => e.message);")
        XCTAssertEqual(closed as? String, "Page closed.")
    }

    @MainActor
    func testAcknowledgedLongOperationOutlivesShortTransportTimeout() async throws {
        let result = try await exerciseBridge(mode: .accepted, body: "return JSON.stringify(await window.clefVoice.call('downloadModel'));" )
        XCTAssertEqual(result as? String, "false")
    }

    @MainActor
    func testProductionAPIThroughSwiftSerializerAndWKBridge() async throws {
        let script = try productionFixtureScript()
        let success = try await exerciseBridge(mode: .normal, body: "return {setup: await window.testAPI.completeSetup(), copy: await window.testAPI.copyText('ไทย') === undefined};", extraScript: script, nativeResult: true)
        let object = try XCTUnwrap(success as? [String: Any])
        XCTAssertEqual(object["setup"] as? Bool, true)
        XCTAssertEqual(object["copy"] as? Bool, true)
        let failure = try await exerciseBridge(mode: .normal, body: "return {setup: await window.testAPI.completeSetup(), copy: await window.testAPI.copyText('ไทย').then(() => 'success', e => e.message)};", extraScript: script)
        let failed = try XCTUnwrap(failure as? [String: Any])
        XCTAssertEqual(failed["setup"] as? Bool, false)
        XCTAssertEqual(failed["copy"] as? String, "Could not copy text")
    }

    @MainActor
    func testOldPageResponseCannotResolveCurrentPageRequest() async throws {
        let body = """
        const old = window.clefVoice.call('copyText').then(() => 'wrong page', e => e.message);
        window.__clefVoicePage = 'replacement page';
        const current = await window.clefVoice.call('copyText');
        return {old:await old, current};
        """
        let result = try await exerciseBridge(mode: .normal, body: body) as? [String: Any]
        XCTAssertTrue((result?["old"] as? String)?.contains("timed out") == true)
        XCTAssertEqual(result?["current"] as? Bool, false)
    }

    @MainActor
    func testRealSetupExitsOnlyWhenNativeReturnsTrue() async throws {
        let script = try productionFixtureScript(mode: "setup")
        let body = """
        const wait = () => new Promise(resolve => setTimeout(resolve, 50));
        await wait();
        const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
        button('Continue').click(); await wait();
        button('Finish setup').click(); await wait();
        return {completed:window.testSetup.completed, error:document.querySelector('[role=alert]')?.textContent || ''};
        """
        let successful = try await exerciseBridge(mode: .normal, body: body, extraScript: script, nativeResult: true) as? [String: Any]
        XCTAssertEqual(successful?["completed"] as? Bool, true)
        let failed = try await exerciseBridge(mode: .normal, body: body, extraScript: script) as? [String: Any]
        XCTAssertEqual(failed?["completed"] as? Bool, false)
        XCTAssertTrue((failed?["error"] as? String)?.contains("permissions") == true)
    }

    @MainActor
    func testMainAppOnlyShowsSetupUntilCompletion() async throws {
        let script = try productionFixtureScript(mode: "main")
        let results = mainAppResults()
        let helper = """
        const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
        const waitFor = async predicate => { for (let i=0;i<40;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,50)); } throw new Error('UI did not settle'); };
        """
        let returning = try await exerciseBridge(mode: .normal, body: helper + """
        await waitFor(() => button('Preferences')); button('Preferences').click();
        await waitFor(() => document.body.textContent.includes('Permissions'));
        return {reopenButton:!!button('Run setup again'), setup:document.querySelector('h1')?.textContent === 'Welcome to ClefVoice'};
        """, extraScript: script, nativeResults: results) as? [String: Any]
        XCTAssertEqual(returning?["reopenButton"] as? Bool, false)
        XCTAssertEqual(returning?["setup"] as? Bool, false)

        var firstRun = results
        firstRun["getSetupState"] = ["completed": false]
        let fresh = try await exerciseBridge(mode: .normal, body: helper + """
        await waitFor(() => button('Continue'));
        const initialSetup = document.querySelector('h1')?.textContent === 'Welcome to ClefVoice';
        const firstFooter = [...document.querySelectorAll('footer button')].map(b=>b.textContent.trim());
        button('Continue').click(); await waitFor(() => button('Finish setup'));
        const modelFooter = [...document.querySelectorAll('footer button')].map(b=>b.textContent.trim());
        button('Finish setup').click(); await waitFor(() => button('Preferences'));
        return {initialSetup, firstFooter, modelFooter, finished:!button('Finish setup')};
        """, extraScript: script, nativeResults: firstRun) as? [String: Any]
        XCTAssertEqual(fresh?["initialSetup"] as? Bool, true)
        XCTAssertEqual(fresh?["firstFooter"] as? [String], ["Continue"])
        XCTAssertEqual(fresh?["modelFooter"] as? [String], ["Back", "Finish setup"])
        XCTAssertEqual(fresh?["finished"] as? Bool, true)
    }

    @MainActor
    func testSettingsRecoveryCannotOverwriteNewerConfirmedSettings() async throws {
        let script = try productionFixtureScript(mode: "main")
        for newerSave in [false, true] {
            let body = """
            const wait = () => new Promise(r => setTimeout(r,25));
            const waitFor = async predicate => { for(let i=0;i<80;i++) { if(predicate()) return; await wait(); } throw new Error('UI did not settle'); };
            const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
            await waitFor(() => button('Voice & Audio')); button('Voice & Audio').click();
            const vad = () => document.querySelector('[aria-label="Silence trimming"]');
            await waitFor(vad); vad().click();
            await waitFor(() => window.testRollbackPending);
            if (\(newerSave)) document.querySelector('[aria-label="Auto-stop"]').click();
            window.__clefVoiceEmit('settings', {selectedLanguages:[],modelSize:'base',hotkey:'Fn',vadEnabled:false,vadThreshold:0.012,autoStopEnabled:true,autoStopSeconds:0.9,removeFillerWords:true,autoCapitalize:true,customVocabulary:[]});
            await new Promise(r => setTimeout(r,350));
            return {vad:vad().getAttribute('aria-checked'), autoStop:document.querySelector('[aria-label="Auto-stop"]').getAttribute('aria-checked')};
            """
            let result = try await exerciseBridge(mode: .settingsFailure, body: body, extraScript: script, nativeResults: mainAppResults()) as? [String: Any]
            XCTAssertEqual(result?["vad"] as? String, "false")
            XCTAssertEqual(result?["autoStop"] as? String, "true")
        }
    }

    @MainActor
    func testSetupShowsDownloadFailureOnlyOnceUnderItsModel() async throws {
        let script = try productionFixtureScript(mode: "setup")
        for inventoryFailure in [false, true] {
            let body = """
            const wait = () => new Promise(resolve => setTimeout(resolve, 50));
            const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
            const inventory = {...window.testSetup.inventory,items:window.testSetup.inventory.items.map(item => ({...item, active:false, present:false, downloaded:false, status:'not_downloaded'}))};
            window.testSetup.render(inventory); await wait(); button('Continue').click(); await wait();
            button('Download & use').click();
            for (let i=0;i<40 && !document.body.textContent.includes('Download failed in fixture.');i++) await wait();
            if (\(inventoryFailure)) {
                inventory.items[0] = {...inventory.items[0],status:'failed',error:'Download failed in fixture.'};
                window.testSetup.setStatus('error','Download failed in fixture.');
                window.testSetup.render(inventory); await wait();
            }
            const alerts = [...document.querySelectorAll('[role=alert]')].filter(e => e.textContent === 'Download failed in fixture.');
            const result = {count:alerts.length, inRow:alerts.every(e => e.closest('.model-row')?.querySelector('h3')?.textContent === inventory.items[0].name), footer:!!document.querySelector('footer [role=alert]')};
            window.testSetup.setStatus('error','Engine unavailable in fixture.'); await wait();
            return {...result, unrelatedError:document.querySelector('footer [role=alert]')?.textContent};
            """
            let result = try await exerciseBridge(mode: .downloadFailure, body: body, extraScript: script) as? [String: Any]
            XCTAssertEqual(result?["count"] as? Int, 1)
            XCTAssertEqual(result?["inRow"] as? Bool, true)
            XCTAssertEqual(result?["footer"] as? Bool, false)
            XCTAssertEqual(result?["unrelatedError"] as? String, "Engine unavailable in fixture.")
        }
    }

    @MainActor
    func testSetupConnectionChangeUnlocksPendingDownload() async throws {
        let script = try productionFixtureScript(mode: "setup")
        let body = """
        const wait = () => new Promise(resolve => setTimeout(resolve, 50));
        const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
        const inventory = {...window.testSetup.inventory,items:window.testSetup.inventory.items.map(item => ({...item, active:false, present:false, downloaded:false, status:'not_downloaded'}))};
        window.testSetup.render(inventory); await wait(); button('Continue').click(); await wait();
        button('Download & use').click(); await wait();
        window.testSetup.render({...inventory, generation:2, connected:false}); await wait();
        return {backEnabled:!button('Back').disabled, error:[...document.querySelectorAll('[role=alert]')].map(e => e.textContent).join(' ')};
        """
        let result = try await exerciseBridge(mode: .drop, body: body, extraScript: script) as? [String: Any]
        XCTAssertEqual(result?["backEnabled"] as? Bool, true)
        XCTAssertTrue((result?["error"] as? String)?.contains("connection changed") == true)
    }

    @MainActor
    func testProductionAPIReadsAndValidatesSettingsThroughRealCore() async throws {
        guard let binary = ProcessInfo.processInfo.environment["CLEF_TEST_ENGINE"] else {
            throw XCTSkip("Set CLEF_TEST_ENGINE for the native-helper boundary test")
        }
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        var environment = ProcessInfo.processInfo.environment
        environment["HOME"] = home.path
        let engine = EngineClient(enginePath: { binary }, environment: environment,
            arguments: ["--models-dir", home.appendingPathComponent("models").path], retryLimit: 0)
        defer { engine.onEvent = nil; engine.terminate() }
        let ready = expectation(description: "isolated core ready")
        var received = false
        engine.onEvent = { event in
            if case .ready = event, !received { received = true; ready.fulfill() }
        }
        engine.launch()
        await fulfillment(of: [ready], timeout: 5)
        let script = try productionFixtureScript()
        let body = """
        const initial = await window.testAPI.getSettings();
        await window.testAPI.updateSettings({vadEnabled:false,selectedLanguages:['ja'],customVocabulary:['คำเฉพาะ']});
        const saved = await window.testAPI.getSettings();
        let invalidRejected = false;
        try { await window.testAPI.updateSettings({autoStopSeconds:-1}); } catch { invalidRejected = true; }
        let invalidTypeRejected = false;
        try { await window.testAPI.updateSettings({vadEnabled:'wrong-type'}); } catch { invalidTypeRejected = true; }
        const afterFailure = await window.testAPI.getSettings();
        const languages = await window.testAPI.getLanguages();
        let modelRejected = false;
        try { await window.testAPI.loadModel('not-a-model'); } catch { modelRejected = true; }
        return {initial,saved,afterFailure,languages,invalidRejected,invalidTypeRejected,modelRejected};
        """
        let response = try await exerciseBridge(mode: .normal, body: body, extraScript: script, engine: engine)
        let result = try XCTUnwrap(response as? [String: Any])
        let saved = try XCTUnwrap(result["saved"] as? [String: Any])
        XCTAssertEqual(saved["vadEnabled"] as? Bool, false)
        XCTAssertEqual(saved["selectedLanguages"] as? [String], ["ja"])
        XCTAssertEqual(saved["customVocabulary"] as? [String], ["คำเฉพาะ"])
        XCTAssertEqual((result["afterFailure"] as? NSDictionary), saved as NSDictionary)
        XCTAssertEqual((result["languages"] as? [[String: Any]])?.count, 27)
        XCTAssertEqual(result["invalidRejected"] as? Bool, true)
        XCTAssertEqual(result["invalidTypeRejected"] as? Bool, true)
        XCTAssertEqual(result["modelRejected"] as? Bool, true)
    }

    private func mainAppResults() -> [String: Any] {
        return [
            "getSetupState": ["completed": true],
            "getSettings": ["selectedLanguages": [], "modelSize": "base", "hotkey": "Fn", "vadEnabled": true,
                "vadThreshold": 0.012, "autoStopEnabled": false, "autoStopSeconds": 0.9,
                "removeFillerWords": true, "autoCapitalize": true, "customVocabulary": []] as [String: Any],
            "getState": ["status": "idle", "message": "", "progress": 0] as [String: Any],
            "getModels": ["busy": false, "items": [["id": "base", "name": "Base", "sizeLabel": "148 MB",
                "active": true, "downloaded": true, "present": true, "status": "downloaded",
                "languages": [], "languageLabel": "Multilingual", "quantization": "F16", "progress": 1,
                "receivedBytes": 0, "totalBytes": 0] as [String: Any]]] as [String: Any],
            "checkPermissions": ["microphone": true, "accessibility": true, "inputMonitoring": false],
            "getLanguages": [], "getHistory": [],
            "getStats": ["totalWords": 0, "dictationCount": 0, "speechWpm": 0, "minutesSaved": 0, "activeDays": []] as [String: Any],
            "completeSetup": true,
        ]
    }

    private func productionFixtureScript(mode: String = "api") throws -> String {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", root.appendingPathComponent("scripts/tests/fixtures/web.mjs").path, mode]
        let output = Pipe()
        process.standardOutput = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    @MainActor
    private func exerciseBridge(mode: BridgeHarness.Mode, body: String, extraScript: String = "", nativeResult: Bool = false, nativeResults: [String: Any] = [:], engine: EngineClient? = nil) async throws -> Any? {
        let loaded = expectation(description: "bridge document loaded")
        let harness = BridgeHarness(loaded: loaded)
        harness.mode = mode
        harness.result = nativeResult
        harness.nativeResults = nativeResults
        harness.engine = engine
        let content = WKUserContentController()
        content.add(harness, name: "clefVoice")
        content.add(harness, name: "testResult")
        content.addUserScript(WKUserScript(source: extraScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: WebBridge.makeScript(timeoutMilliseconds: 500), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = content
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        harness.webView = webView
        webView.navigationDelegate = harness
        defer { webView.stopLoading(); webView.navigationDelegate = nil }
        webView.loadHTMLString("<!doctype html><html></html>", baseURL: nil)
        await fulfillment(of: [loaded], timeout: 10)
        let finished = expectation(description: "JS promise settled")
        var response: Result<Any, Error>?
        harness.onResult = { result in response = result; finished.fulfill() }
        let runner = "(async function () { \(body) })().then(value => window.webkit.messageHandlers.testResult.postMessage({ok:true, value:value ?? null}), error => window.webkit.messageHandlers.testResult.postMessage({ok:false, error:error.message})); void 0;"
        webView.evaluateJavaScript(runner) { _, error in
            if let error { XCTFail("Could not start bridge exercise: \(error)") }
        }
        await fulfillment(of: [finished], timeout: 5)
        content.removeScriptMessageHandler(forName: "clefVoice")
        content.removeScriptMessageHandler(forName: "testResult")
        return try XCTUnwrap(response).get()
    }

}

// Stub only the business operation; transport, serialization and injected JS are production code.
@MainActor
private final class BridgeHarness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    enum Mode { case normal, drop, accepted, downloadFailure, settingsFailure }
    var mode: Mode = .normal
    var onResult: ((Result<Any, Error>) -> Void)?
    weak var webView: WKWebView?
    var result = false
    var engine: EngineClient?
    var nativeResults: [String: Any] = [:]
    var methods: [String] = []
    var trustedRoot: URL?
    var blockedFrames = 0
    private let loaded: XCTestExpectation

    init(loaded: XCTestExpectation) { self.loaded = loaded }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded.fulfill()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "testResult", let response = message.body as? [String: Any] {
            if response["ok"] as? Bool == true { onResult?(.success(response["value"] ?? NSNull())) }
            else { onResult?(.failure(EngineFailure(response["error"] as? String ?? "JS failed"))) }
            return
        }
        if let root = trustedRoot,
           !WebBridge.isTrustedPage(message.frameInfo.request.url, isMainFrame: message.frameInfo.isMainFrame, webRoot: root, development: false) {
            blockedFrames += 1
            return
        }
        guard let body = message.body as? String,
              let json = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
              let id = json["id"] as? Int, let method = json["method"] as? String else {
            XCTFail("Invalid request from injected bridge")
            return
        }
        let page = json["page"] as? String ?? ""
        func reply(_ script: String) {
            webView?.evaluateJavaScript(WebBridge.pageScript(script, page: page), completionHandler: { _, error in XCTAssertNil(error) })
        }
        methods.append(method)
        if mode == .drop { return }
        do { try MainWindowController.validateMethod(method) }
        catch { reply(WebBridge.rejectScript(id: id, message: error.localizedDescription)); return }
        if let engine {
            do {
                let command = try XCTUnwrap(MainWindowController.engineCommand(method: method, params: json["params"] as? [String: Any] ?? [:]))
                engine.request(command, accepted: { reply("window.__clefVoiceAccepted(\(id));") }) { result in
                    do {
                        let value = try MainWindowController.engineResponse(method: method, value: result.get())
                        reply(WebBridge.resolveScript(id: id, result: value))
                    } catch { reply(WebBridge.rejectScript(id: id, message: error.localizedDescription)) }
                }
            } catch { reply(WebBridge.rejectScript(id: id, message: error.localizedDescription)) }
            return
        }
        if mode == .settingsFailure && method == "updateSettings" && methods.filter({ $0 == method }).count == 1 {
            reply(WebBridge.rejectScript(id: id, message: "Settings save failed in fixture.")); return
        }
        if mode == .settingsFailure && method == "getSettings" && methods.filter({ $0 == method }).count > 1 {
            let response = WebBridge.resolveScript(id: id, result: nativeResults[method])
            reply("window.testRollbackPending = true; setTimeout(function () { \(response) }, 250); void 0;")
            return
        }
        if mode == .downloadFailure && method == "downloadModel" {
            reply(WebBridge.rejectScript(id: id, message: "Download failed in fixture.")); return
        }
        if mode == .accepted {
            reply("window.__clefVoiceAccepted(\(id));")
            let terminal = WebBridge.pageScript(WebBridge.resolveScript(id: id, result: result), page: page)
            webView?.evaluateJavaScript("setTimeout(function () { \(terminal) }, 750); void 0;", completionHandler: { _, error in XCTAssertNil(error) })
            return
        }
        reply(WebBridge.resolveScript(id: id, result: nativeResults[method] ?? result))
    }
}
