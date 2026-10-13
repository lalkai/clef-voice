import XCTest
@testable import ClefVoice

final class EngineRecoveryTests: XCTestCase {
    private func fixture(_ script: String, executable: Bool = true) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: folder) }
        let path = folder.appendingPathComponent("engine")
        try ("#!/bin/sh\n" + script).write(to: path, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: executable ? 0o700 : 0o600], ofItemAtPath: path.path)
        return path
    }

    @MainActor
    func testDefaultEnvironmentPreservesHomeAndExplicitEnvironmentRemainsIsolated() async throws {
        let inheritedHome = try XCTUnwrap(ProcessInfo.processInfo.environment["HOME"])
        XCTAssertFalse(inheritedHome.isEmpty)
        for explicitHome in [nil, "/tmp/clef-engine-isolated-home"] as [String?] {
            let path = try fixture("printf '{\"type\":\"ready\",\"version\":\"%s\"}\\n' \"${HOME-}\"\nwhile read line; do :; done\n")
            let engine = EngineClient(enginePath: { path.path }, environment: explicitHome.map { ["HOME": $0] }, retryLimit: 0)
            let ready = expectation(description: "child reports its HOME")
            engine.onEvent = { event in
                if case .ready(let home) = event {
                    XCTAssertEqual(home, explicitHome ?? inheritedHome)
                    ready.fulfill()
                }
            }
            engine.launch()
            await fulfillment(of: [ready], timeout: 3)
            engine.terminate()
        }
    }

    @MainActor
    func testMissingBinaryRetriesAreBoundedAndSendDoesNotRelaunch() async throws {
        var attempts = 0
        let engine = EngineClient(enginePath: { attempts += 1; return nil }, retryDelay: 0.01, retryLimit: 2)
        engine.launch()
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(attempts, 3)
        for _ in 0..<5 { engine.send(["cmd": "get_history"]) }
        XCTAssertEqual(attempts, 3)
        engine.retry()
        XCTAssertEqual(attempts, 4)
        engine.terminate()
    }

    @MainActor
    func testNonExecutableAndCrashingProcessHaveBoundedRetries() async throws {
        for executable in [false, true] {
            let path = try fixture("exit 1\n", executable: executable)
            var attempts = 0
            let engine = EngineClient(enginePath: { attempts += 1; return path.path }, retryDelay: 0.01, retryLimit: 1)
            engine.launch()
            try await Task.sleep(nanoseconds: 300_000_000)
            XCTAssertEqual(attempts, 2)
            engine.terminate()
        }
    }

    @MainActor
    func testPipeFailureRejectsRequestWithoutReplayingIt() async throws {
        let path = try fixture("exec 0<&-\nprintf '{\"type\":\"ready\"}\\n'\nsleep 1\n")
        let engine = EngineClient(enginePath: { path.path }, retryLimit: 0)
        let failed = expectation(description: "broken pipe rejected")
        engine.onEvent = { event in
            if case .ready = event {
                engine.request(["cmd": "start"], accepted: { XCTFail("Broken pipe cannot accept a request") }) { result in
                    if case .success = result { XCTFail("Write failure reported success") }
                    failed.fulfill()
                }
            }
        }
        engine.launch()
        await fulfillment(of: [failed], timeout: 3)
        engine.terminate()
    }

    @MainActor
    func testCommandResultsFromRealGoCoreInIsolatedHome() async throws {
        guard let binary = ProcessInfo.processInfo.environment["CLEF_TEST_ENGINE"] else {
            throw XCTSkip("Build clefd and set CLEF_TEST_ENGINE for the cross-process smoke test")
        }
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: home) }
        var environment = ProcessInfo.processInfo.environment
        environment["HOME"] = home.path
        let engine = EngineClient(enginePath: { binary }, environment: environment, arguments: ["--models-dir", home.appendingPathComponent("models").path], retryLimit: 0)
        let saved = expectation(description: "real core saved settings")
        let rejected = expectation(description: "real core rejected unknown model")
        var requested = false
        engine.onEvent = { event in
            guard case .ready = event, !requested else { return }
            requested = true
            engine.request(["cmd":"set_config", "config":["custom_vocabulary":[" ไทย ","ไทย","Swift"]]], accepted: {}) { result in
                if case .failure(let error) = result { XCTFail(error.localizedDescription) }
                saved.fulfill()
            }
            engine.request(["cmd":"load_model", "model":"unknown"], accepted: { XCTFail("Invalid model accepted") }) { result in
                if case .success = result { XCTFail("Invalid model reported success") }
                rejected.fulfill()
            }
        }
        engine.launch()
        await fulfillment(of: [saved, rejected], timeout: 5)
        let exit = expectation(description: "real core exited")
        engine.shutdown { exit.fulfill() }
        await fulfillment(of: [exit], timeout: 5)
        let data = try Data(contentsOf: home.appendingPathComponent(".clefvoice/config.json"))
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(config["custom_vocabulary"] as? [String], ["ไทย", "Swift"])
    }

    @MainActor
    func testConsecutiveSettingsPatchesSurviveRealEngineRestart() async throws {
        guard let binary = ProcessInfo.processInfo.environment["CLEF_TEST_ENGINE"] else {
            throw XCTSkip("Set CLEF_TEST_ENGINE for the cross-process restart test")
        }
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: home) }
        var environment = ProcessInfo.processInfo.environment
        environment["HOME"] = home.path
        let patches: [[String: Any]] = [
            ["vadEnabled": false],
            ["autoStopEnabled": true, "autoStopSeconds": 1.2],
            ["customVocabulary": ["คำเฉพาะ", "Swift"]],
            ["selectedLanguages": ["ja"], "hotkey": "RightOption"],
        ]
        let commands = try patches.map { try XCTUnwrap(MainWindowController.engineCommand(method: "updateSettings", params: ["settings": $0])) }
        for restart in [false, true] {
            let engine = EngineClient(enginePath: { binary }, environment: environment, arguments: ["--models-dir", home.appendingPathComponent("models").path], retryLimit: 0)
            defer { engine.onEvent = nil; engine.terminate() }
            let settled = expectation(description: restart ? "settings loaded after restart" : "consecutive patches saved")
            settled.expectedFulfillmentCount = restart ? 1 : commands.count
            var requested = false
            var received = false
            var snapshot: [String: Any] = [:]
            engine.onEvent = { event in
                if case .config(let config) = event {
                    snapshot = config
                    if restart && !received { received = true; settled.fulfill() }
                }
                guard case .ready = event, !requested else { return }
                requested = true
                if !restart {
                    for command in commands {
                        engine.request(command, accepted: {}) { result in
                            if case .failure(let error) = result { XCTFail(error.localizedDescription) }
                            settled.fulfill()
                        }
                    }
                }
            }
            engine.launch()
            await fulfillment(of: [settled], timeout: 5)
            XCTAssertEqual(snapshot["vad_enabled"] as? Bool, false)
            XCTAssertEqual(snapshot["auto_stop_enabled"] as? Bool, true)
            XCTAssertEqual(snapshot["auto_stop_seconds"] as? Double, 1.2)
            XCTAssertEqual(snapshot["custom_vocabulary"] as? [String], ["คำเฉพาะ", "Swift"])
            XCTAssertEqual(snapshot["languages"] as? [String], ["ja"])
            XCTAssertEqual(snapshot["hotkey"] as? String, "RightOption")
            let exited = expectation(description: "core shutdown")
            engine.shutdown { exited.fulfill() }
            await fulfillment(of: [exited], timeout: 5)
        }
    }

    @MainActor
    func testSettingsReadUsesRealCoreInsteadOfNativeCache() async throws {
        guard let binary = ProcessInfo.processInfo.environment["CLEF_TEST_ENGINE"] else {
            throw XCTSkip("Set CLEF_TEST_ENGINE for the authoritative settings test")
        }
        let read = try XCTUnwrap(MainWindowController.engineCommand(method: "getSettings", params: [:]))
        let languages = try XCTUnwrap(MainWindowController.engineCommand(method: "getLanguages", params: [:]))
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: home) }
        var environment = ProcessInfo.processInfo.environment
        environment["HOME"] = home.path
        let engine = EngineClient(enginePath: { binary }, environment: environment,
            arguments: ["--models-dir", home.appendingPathComponent("models").path], retryLimit: 0)
        defer { engine.onEvent = nil; engine.terminate() }
        let completed = expectation(description: "core owns settings reads and language choices")
        var requested = false
        engine.onEvent = { event in
            guard case .ready = event, !requested else { return }
            requested = true
            engine.request(["cmd": "set_config", "config": ["languages": ["ja"], "vad_enabled": false]], accepted: {}) { result in
                if case .failure(let error) = result { XCTFail(error.localizedDescription) }
                engine.request(read, accepted: {}) { result in
                    do {
                        let config = try XCTUnwrap(try result.get() as? [String: Any])
                        XCTAssertEqual(config["languages"] as? [String], ["ja"])
                        XCTAssertEqual(config["vad_enabled"] as? Bool, false)
                        let settings = try XCTUnwrap(MainWindowController.engineResponse(method: "getSettings", value: config) as? [String: Any])
                        XCTAssertEqual(settings["selectedLanguages"] as? [String], ["ja"])
                        XCTAssertEqual(settings["vadEnabled"] as? Bool, false)
                        let script = WebBridge.resolveScript(id: 7, result: settings)
                        XCTAssertTrue(script.contains("vadEnabled"))
                    } catch { XCTFail(error.localizedDescription) }
                    engine.request(languages, accepted: {}) { result in
                        do {
                            let choices = try XCTUnwrap(try result.get() as? [[String: Any]])
                            XCTAssertEqual(choices.count, 27)
                            XCTAssertEqual(choices.first?["code"] as? String, "th")
                            XCTAssertEqual(choices.first?["name"] as? String, "Thai (ภาษาไทย)")
                        } catch { XCTFail(error.localizedDescription) }
                        completed.fulfill()
                    }
                }
            }
        }
        engine.launch()
        await fulfillment(of: [completed], timeout: 5)
    }

    @MainActor
    func testGracefulShutdownDeliversCommandBeforeProcessExits() async throws {
        let path = try fixture("while read line; do case \"$line\" in *shutdown*) exit 0;; esac; done\n")
        let engine = EngineClient(enginePath: { path.path }, retryLimit: 0)
        engine.launch()
        let exited = expectation(description: "graceful exit")
        engine.shutdown { exited.fulfill() }
        await fulfillment(of: [exited], timeout: 2)
    }
}
