import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateConfig(config) {
  if (!config || typeof config !== "object")
    throw new Error("Config must be an object");
  if (
    typeof config.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(config.version)
  )
    throw new Error("version must use X.Y.Z");
  if (
    typeof config.name !== "string" ||
    !/^[A-Za-z][A-Za-z0-9-]*$/.test(config.name)
  )
    throw new Error("Invalid app name");
  if (
    typeof config.bundleIdentifier !== "string" ||
    !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(config.bundleIdentifier)
  )
    throw new Error("Invalid bundle identifier");
  if (!Number.isFinite(config.typingWpm) || config.typingWpm <= 0)
    throw new Error("typingWpm must be positive");
  if (
    !Number.isFinite(config.defaultVadThreshold) ||
    config.defaultVadThreshold <= 0 ||
    config.defaultVadThreshold > 1
  )
    throw new Error("Invalid VAD threshold");
  if (
    !config.vadLevels ||
    typeof config.vadLevels !== "object" ||
    !["high", "normal", "low"].every(
      (key) =>
        Number.isFinite(config.vadLevels[key]) &&
        config.vadLevels[key] > 0 &&
        config.vadLevels[key] <= 1,
    ) ||
    !(
      config.vadLevels.high < config.vadLevels.normal &&
      config.vadLevels.normal < config.vadLevels.low
    )
  )
    throw new Error("Invalid VAD levels");
  if (!Array.isArray(config.models) || !config.models.length)
    throw new Error("models must not be empty");
  const ids = new Set();
  const swiftCases = new Set();
  for (const model of config.models) {
    if (
      !model ||
      typeof model.id !== "string" ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(model.id) ||
      ids.has(model.id)
    )
      throw new Error("Invalid or duplicate model ID");
    ids.add(model.id);
    const swiftCase = model.id.replace(/-([a-z0-9])/g, (_, letter) =>
      letter.toUpperCase(),
    );
    if (swiftCases.has(swiftCase))
      throw new Error("Model IDs produce duplicate Swift cases");
    swiftCases.add(swiftCase);
    if (
      ![model.name, model.label, model.description].every(
        (value) =>
          typeof value === "string" &&
          value.length > 0 &&
          !/[\x00-\x1f]/.test(value),
      )
    )
      throw new Error("Missing model labels");
    if (!/^[a-f0-9]{64}$/.test(model.sha256))
      throw new Error("Invalid model SHA256");
  }
  if (!ids.has(config.defaultModel))
    throw new Error("defaultModel must exist in models");
}

export function configOutputs(config, packageFiles) {
  validateConfig(config);
  const quote = JSON.stringify;
  const webConfig = {
    ...config,
    models: config.models.map(({ sha256, ...model }) => model),
  };
  const go = [
    "// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.",
    "package appconfig",
    "",
    "const Version = " + quote(config.version),
    "const Name = " + quote(config.name),
    "const BundleIdentifier = " + quote(config.bundleIdentifier),
    "const TypingWPM = " + config.typingWpm,
    "const DefaultModel = " + quote(config.defaultModel),
    "const DefaultVADThreshold = " + config.defaultVadThreshold,
    "",
    "type Model struct {",
    "\tID     string",
    "\tLabel  string",
    "\tSHA256 string",
    "}",
    "",
    "var Models = []Model{",
    ...config.models.map(
      (model) =>
        "\t{" +
        [model.id, model.label, model.sha256].map(quote).join(", ") +
        "},",
    ),
    "}",
    "",
  ].join("\n");
  const swift = [
    "// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.",
    "enum AppConfig {",
    "    static let version = " + quote(config.version),
    "    static let name = " + quote(config.name),
    "    static let bundleIdentifier = " + quote(config.bundleIdentifier),
    "    static let defaultModel: WhisperModelSize = .`" +
      config.defaultModel.replace(/-([a-z0-9])/g, (_, letter) =>
        letter.toUpperCase(),
      ) +
      "`",
    "    static let defaultVadThreshold: Double = " +
      config.defaultVadThreshold,
    "    static let modelLabels: [String: String] = [",
    ...config.models.map(
      (model) => "        " + quote(model.id) + ": " + quote(model.label) + ",",
    ),
    "    ]",
    "}",
    "",
  ].join("\n");
  const swiftModels = [
    "// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.",
    "public enum WhisperModelSize: String, CaseIterable, Identifiable, Codable {",
    ...config.models.map(
      (model) =>
        "    case `" +
        model.id.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase()) +
        "` = " +
        quote(model.id),
    ),
    "",
    "    public var id: String { rawValue }",
    "",
    "    public var displayName: String { AppConfig.modelLabels[rawValue] ?? rawValue }",
    "}",
    "",
  ].join("\n");
  const outputs = new Map([
    [
      "app/src/lib/appConfig.generated.ts",
      "// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.\nexport const appConfig = " +
        JSON.stringify(webConfig, null, 2) +
        " as const;\n",
    ],
    ["core/internal/appconfig/config_generated.go", go],
    ["native/macos/Sources/ClefVoice/Core/AppConfig.generated.swift", swift],
    [
      "native/macos/Sources/ClefVoice/Core/Engine/WhisperModelSize.swift",
      swiftModels,
    ],
  ]);
  for (const [path, source] of packageFiles) {
    const data = JSON.parse(source);
    data.version = config.version;
    if (path.endsWith("package-lock.json"))
      data.packages[""].version = config.version;
    outputs.set(path, JSON.stringify(data, null, 2) + "\n");
  }
  return outputs;
}

export function syncConfig(directory = root, check = false) {
  const config = JSON.parse(
    readFileSync(resolve(directory, "app.config.json"), "utf8"),
  );
  const packages = [
    "package.json",
    "app/package.json",
    "app/package-lock.json",
  ].map((path) => [path, readFileSync(resolve(directory, path), "utf8")]);
  const outputs = configOutputs(config, packages);
  const stale = [];
  for (const [relative, content] of outputs) {
    const path = resolve(directory, relative);
    let existing;
    try {
      existing = readFileSync(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existing === content) continue;
    stale.push(relative);
    if (!check) {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = path + "." + process.pid + ".tmp";
      writeFileSync(temporary, content);
      renameSync(temporary, path);
    }
  }
  return stale;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv[2] === "--get") {
      const config = JSON.parse(
        readFileSync(resolve(root, "app.config.json"), "utf8"),
      );
      validateConfig(config);
      const key = process.argv[3];
      if (!["version", "name", "bundleIdentifier"].includes(key))
        throw new Error("Unsupported config key");
      console.log(config[key]);
    } else {
      if (process.argv.slice(2).some((arg) => arg !== "--check"))
        throw new Error("Use --check or --get <key>");
      const check = process.argv.includes("--check");
      const stale = syncConfig(root, check);
      if (check && stale.length) {
        console.error(
          "Config outputs are stale. Run npm run config:sync:\n" +
            stale.join("\n"),
        );
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error("Config error: " + error.message);
    process.exitCode = 1;
  }
}
