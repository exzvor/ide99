// Offline-first Monaco bootstrap (issue #32).
//
// `@monaco-editor/react`'s default loader fetches the Monaco runtime from a CDN
// (jsDelivr) at mount time; on a machine with no network access (offline,
// air-gapped, or behind a proxy/firewall) that request never resolves and every
// editor hangs forever on "Loading…". We instead hand the loader the
// locally-bundled `monaco-editor` and wire Monaco's web workers through Vite, so
// the editor works fully offline. (`monaco-editor` resolves via the
// monaco-sql-languages dependency; no CDN, no network.)
//
// Imported for its side effects from `main.tsx` BEFORE the React tree mounts, so
// `loader.config({ monaco })` runs before any `<Editor>` initializes — the
// loader is a singleton, so this fixes every Monaco mount site at once.

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import PgSqlWorker from "monaco-sql-languages/esm/languages/pgsql/pgsql.worker?worker";

// monaco-sql-languages spawns a worker labelled with the language id ("pgsql")
// for SQL completion/hover; every other Monaco service uses the base editor
// worker. Both are bundled locally by Vite via the `?worker` imports above.
(self as typeof self & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === "pgsql") {
      return new PgSqlWorker();
    }
    return new EditorWorker();
  },
};

// Use the bundled instance instead of the default CDN AMD loader.
loader.config({ monaco });

// Re-measure glyph metrics once the editor font has actually loaded.
//
// Monaco measures character width/height at construction time. Our editor font
// (JetBrains Mono) is an async `@font-face` with `font-display: swap`, so the
// first editors are measured against a fallback font; when JetBrains Mono then
// swaps in, the cached metrics are stale and the text renders ~half a line off
// with an invisible caret. On WebKit (macOS) the font is usually ready fast
// enough to hide this, but on WebView2 (Windows) it reproduces reliably.
// `remeasureFonts()` is static — it refreshes every mounted editor at once.
if (typeof document !== "undefined" && document.fonts?.ready) {
  document.fonts.ready
    .then(() => monaco.editor.remeasureFonts())
    .catch(() => {
      // Best-effort; a failed font-load promise must not break the editor.
    });
}
