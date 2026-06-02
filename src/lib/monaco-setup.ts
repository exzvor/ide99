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
