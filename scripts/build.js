#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("❌ ClefVoice currently supports macOS only");
  process.exit(1);
}

// `make -C native/macos build` handles the full pipeline:
// Go core (clefd) → web UI (React) → Swift shell → .app bundle.
console.log("🔨 Building ClefVoice (web UI + Go core + Swift shell)...");
const build = spawn("make", ["-C", "native/macos", "build"], { stdio: "inherit" });
build.on("exit", (code) => {
  if (code === 0) {
    console.log("\n✅ ClefVoice build complete! Built: native/macos/ClefVoice.app");
  }
  process.exit(code ?? 0);
});
