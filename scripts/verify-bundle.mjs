import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const bundle = process.argv[2];
if (!bundle) throw new Error("Usage: node scripts/verify-bundle.mjs <app-bundle>");
const config = JSON.parse(readFileSync(new URL("../app.config.json", import.meta.url), "utf8"));
const app = resolve(bundle);
const run = (tool, args) => execFileSync(tool, args, { encoding: "utf8" }).trim();
const plist = key => run("plutil", ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")]);
if (plist("CFBundleShortVersionString") !== config.version) throw new Error("Bundle version mismatch");
if (plist("LSMinimumSystemVersion") !== "13.0") throw new Error("Unexpected minimum macOS version");
let architecture;
for (const name of [config.name, "clefd"]) {
  const binary = join(app, "Contents/MacOS", name);
  const arch = run("lipo", ["-archs", binary]);
  if (architecture && architecture !== arch) throw new Error("App/engine architecture mismatch");
  architecture = arch;
  const build = run("xcrun", ["vtool", "-show-build", binary]);
  const versions = [...build.matchAll(/minos\s+(\d+)(?:\.(\d+))?/g)];
  if (!versions.length || versions.some(([, major, minor]) => +major > 13 || (+major === 13 && +(minor ?? 0) > 0))) {
    throw new Error(`${name} requires a newer macOS than advertised: ${build}`);
  }
  const libraries = run("otool", ["-L", binary]).split("\n").slice(1).map(line => line.trim().split(" (compatibility")[0]);
  if (libraries.some(path => !path.startsWith("/System/Library/") && !path.startsWith("/usr/lib/"))) {
    throw new Error(`${name} depends on a library outside macOS: ${libraries.join(", ")}`);
  }
}
const notices = readFileSync(join(app, "Contents/Resources/THIRD_PARTY_NOTICES.txt"), "utf8");
for (const name of ["ClefVoice", "whisper.cpp", "Go runtime", "malgo", "miniaudio", "react", "lucide", "zustand"]) {
  if (!notices.includes(name)) throw new Error(`Missing license notice: ${name}`);
}
run("codesign", ["--verify", "--deep", "--strict", app]);
console.log(`Verified bundle: ${config.version}, ${architecture}, macOS 13.0 deployment target, bundled licenses and signature.`);
