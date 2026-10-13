import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/bundle-licenses.mjs <output-file>");
const sections = [];
function include(label, path) {
  const text = readFileSync(path, "utf8").trim();
  sections.push(`${label}\n${"=".repeat(72)}\n${text}`);
}
function includePackage(label, directory) {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(licen[cs]e|copying)([.-]|$)/i.test(entry.name));
  if (!files.length) throw new Error(`Missing license for ${label}`);
  for (const file of files) include(label, join(directory, file.name));
}
include("ClefVoice", join(root, "LICENSE"));
include("whisper.cpp / ggml", join(root, "core/third_party/whisper.cpp/LICENSE"));
const goRoot = execFileSync("go", ["env", "GOROOT"], { cwd: join(root, "core"), encoding: "utf8" }).trim();
const goLicense = [join(goRoot, "LICENSE"), join(dirname(goRoot), "LICENSE")].find(existsSync);
if (!goLicense) throw new Error("Go runtime license was not found");
include("Go runtime", goLicense);
const modules = execFileSync("go", ["list", "-m", "-f", "{{if not .Main}}{{.Path}} {{.Version}} {{.Dir}}{{end}}", "all"],
  { cwd: join(root, "core"), encoding: "utf8" }).trim().split("\n").filter(Boolean);
for (const module of modules) {
  const [, name, version, directory] = module.match(/^(\S+) (\S+) (.+)$/) ?? [];
  if (!directory) throw new Error(`Module location unavailable: ${module}`);
  includePackage(`${name} ${version}`, directory);
  if (name === "github.com/gen2brain/malgo") {
    const source = readFileSync(join(directory, "miniaudio.h"), "utf8");
    const start = source.lastIndexOf("This software is available as a choice of the following licenses.");
    if (start < 0) throw new Error("miniaudio license was not found");
    sections.push(`miniaudio\n${"=".repeat(72)}\n${source.slice(start, source.indexOf("*/", start)).trim()}`);
  }
}
const packages = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"],
  { cwd: join(root, "app"), encoding: "utf8" }).trim().split("\n").slice(1);
for (const directory of new Set(packages)) {
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  includePackage(`${pkg.name} ${pkg.version}`, directory);
}
writeFileSync(output, sections.join("\n\n") + "\n");
console.log(`Bundled ${sections.length} license notices.`);
