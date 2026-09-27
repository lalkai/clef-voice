import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// WKWebView loads the UI over file://, which blocks ES module scripts (CORS).
// Convert the entry to a deferred classic script so it runs after document parse.
const fileProtocolPlugin: Plugin = {
  name: "clefvoice:file-protocol",
  enforce: "post",
  transformIndexHtml(html) {
    return html
      .replace(/<link rel="modulepreload"[^>]*>/g, "")
      .replace(/<script /g, "<script defer ")
      .replace(/ type="module"/g, "")
      .replace(/ crossorigin/g, "");
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(), fileProtocolPlugin],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
  },
  build: {
    target: "es2021",
    outDir: "dist",
    sourcemap: false,
  },
});
