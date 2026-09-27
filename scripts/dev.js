#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("❌ ClefVoice currently supports macOS only");
  process.exit(1);
}

console.log("🚀 Starting ClefVoice (dev):");
console.log("  ├── 🐹 Go core engine (core/clefd)");
console.log("  ├── 🌐 Web UI (React)");
console.log("  └── 🍏 macOS Helper (Swift shell)");

console.log("🔨 Building...");
const build = spawn("make", ["-C", "native/macos", "build"], { stdio: "inherit" });
build.on("exit", (code) => {
  if (code !== 0) {
    console.error("❌ Build failed");
    process.exit(code ?? 1);
  }

  console.log("🍏 Launching ClefVoice.app...");
  const app = spawn("open", ["native/macos/ClefVoice.app"], { stdio: "inherit" });
  app.on("exit", () => process.exit(0));
});
