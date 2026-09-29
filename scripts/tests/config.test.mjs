import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "../../app/node_modules/typescript/lib/typescript.js";
import { configOutputs, syncConfig } from "../sync-config.mjs";

const original = JSON.parse(
  readFileSync(new URL("../../app.config.json", import.meta.url), "utf8"),
);
const packages = [
  [
    "package.json",
    JSON.stringify({ version: "old", scripts: { build: "keep me" } }),
  ],
  [
    "app/package.json",
    JSON.stringify({ version: "old", dependencies: { react: "unchanged" } }),
  ],
  [
    "app/package-lock.json",
    JSON.stringify({
      version: "old",
      packages: { "": { version: "old" }, dependency: { version: "keep me" } },
    }),
  ],
];

test("one config change reaches web, Go, Swift, and package metadata", async () => {
  const config = structuredClone(original);
  config.version = "9.8.7";
  config.typingWpm = 55;
  config.defaultModel = "tiny";
  config.defaultVadThreshold = 0.015;
  config.models[0].label = "Updated model";
  const outputs = configOutputs(config, packages);
  const webSource = outputs.get("app/src/lib/appConfig.generated.ts");
  const { outputText } = ts.transpileModule(webSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  });
  const { appConfig } = await import(
    "data:text/javascript;base64," + Buffer.from(outputText).toString("base64")
  );
  assert.equal(appConfig.version, config.version);
  assert.equal(appConfig.typingWpm, 55);
  assert.equal(appConfig.defaultModel, "tiny");
  assert.equal(appConfig.models[0].label, "Updated model");
  assert.equal(appConfig.models[0].sha256, undefined);
  assert.deepEqual(appConfig.vadLevels, config.vadLevels);
  const go = outputs.get("core/internal/appconfig/config_generated.go");
  assert.match(go, /Version = "9\.8\.7"/);
  assert.match(go, /TypingWPM = 55/);
  assert.ok(go.includes(config.models[0].sha256));
  const swift = outputs.get(
    "native/macos/Sources/ClefVoice/Core/AppConfig.generated.swift",
  );
  assert.match(swift, /version = "9\.8\.7"/);
  assert.match(swift, /defaultModel: WhisperModelSize = .`tiny`/);
  assert.ok(swift.includes('"tiny": "Updated model"'));
  for (const [path] of packages)
    assert.equal(JSON.parse(outputs.get(path)).version, config.version);
  assert.equal(
    JSON.parse(outputs.get("package.json")).scripts.build,
    "keep me",
  );
  const lock = JSON.parse(outputs.get("app/package-lock.json"));
  assert.equal(lock.packages[""].version, config.version);
  assert.equal(lock.packages.dependency.version, "keep me");
});

test("sync detects drift without writing in check mode and leaves current files untouched", () => {
  const directory = mkdtempSync(join(tmpdir(), "clef-config-"));
  try {
    mkdirSync(join(directory, "app"));
    writeFileSync(join(directory, "app.config.json"), JSON.stringify(original));
    for (const [path, content] of packages)
      writeFileSync(join(directory, path), content);
    const before = readFileSync(join(directory, "package.json"), "utf8");
    assert.ok(syncConfig(directory, true).length > 0);
    assert.equal(readFileSync(join(directory, "package.json"), "utf8"), before);
    syncConfig(directory);
    assert.deepEqual(syncConfig(directory, true), []);
    const timestamp = statSync(join(directory, "package.json")).mtimeMs;
    assert.deepEqual(syncConfig(directory), []);
    assert.equal(statSync(join(directory, "package.json")).mtimeMs, timestamp);
    writeFileSync(
      join(directory, "app/src/lib/appConfig.generated.ts"),
      "stale",
    );
    assert.deepEqual(syncConfig(directory, true), [
      "app/src/lib/appConfig.generated.ts",
    ]);
    assert.equal(
      readFileSync(
        join(directory, "app/src/lib/appConfig.generated.ts"),
        "utf8",
      ),
      "stale",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid shared values fail before outputs can be generated", () => {
  for (const patch of [
    { version: "v0.4" },
    { typingWpm: 0 },
    { defaultModel: "missing" },
    { name: "../escape" },
    { name: undefined },
    { bundleIdentifier: undefined },
    { defaultVadThreshold: NaN },
    { models: [] },
    { vadLevels: undefined },
    { vadLevels: null },
    { vadLevels: { high: 0.012, normal: 0.005, low: 0.025 } },
    { vadLevels: { high: 0.005, normal: 0.005, low: 0.025 } },
    { vadLevels: { high: -1, normal: 0.012, low: 0.025 } },
    { models: [original.models[0], original.models[0]] },
    { models: [{ ...original.models[0], sha256: "unverified" }] },
  ])
    assert.throws(() => configOutputs({ ...original, ...patch }, packages));
});
