import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Inject package.json version as VITE_APP_VERSION so the crash reporter
// and any other build-time consumers don't fall back to the legacy
// "0.1.0" default. Without this `define`, import.meta.env.VITE_APP_VERSION
// is unset in production builds and the fallback in CrashReporterHost.tsx
// reports stale metadata.
const pkgVersion: string = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
).version;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  // Vue plugin is needed only for the pev2 (Vue 3) island used by the
  // Sprint 9 EXPLAIN visualizer; React remains the primary framework.
  plugins: [react(), vue(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkgVersion),
  },
  // Tauri expects fixed port + strict; fail rather than try another port.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Tauri uses Chromium on Windows + WebKit on macOS/Linux.
  build: {
    target: ["es2022", "chrome105", "safari15"],
    // Multi-entry: the main React app + the isolated Vue 3 / pev2 iframe
    // island. The island ships Bootstrap and pev2 inside its own document
    // so neither leaks into the React app's global CSS.
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        pev2Island: resolve(__dirname, "pev2-island.html"),
      },
    },
  },
  // S26 — the pgvector projection view spawns a Web Worker that lazy-imports
  // `umap-js`. Lazy imports inside a worker require `format: "es"` because the
  // default IIFE/UMD format doesn't support code-splitting.
  worker: {
    format: "es",
  },
}));
