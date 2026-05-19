import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";

import { useFileSharing } from "./store";
import type { ShareEnvelope, ShareKind } from "./types";

/**
 * `.ide99` import panel — rendered inline inside the Settings Import/Export tab.
 *
 * Was previously a modal (`ShareImportDialog`) opened from a button in the
 * Settings tab. That created two identical "Choose .ide99 file..." buttons
 * back-to-back: the user clicked once to open the modal, then clicked the
 * same-labelled button again to actually trigger the OS file picker. The
 * modal also nested poorly inside the Radix Settings dialog (clicks outside
 * Dialog.Content were intercepted by Radix focus / dismiss handlers, which
 * felt like clicks weren't registering).
 *
 * Now: the panel lives directly in the Settings tab content. One click → OS
 * file picker; preview + Apply appear in place once a file is chosen.
 *
 * Apply dispatches by `preview.kind` (same as before):
 * - `connection` / `connection-bundle` → returned envelope (Connection
 * Manager UI consumes the parsed payload — credentials never carry over).
 * - `snippet` / `snippet-bundle` → `ide99_apply_snippet*`.
 * - `query` → `ide99_apply_query`.
 * - `notebook` → `ide99_apply_notebook`.
 * - `migration-set` → `ide99_apply_migration_set` requires a destination
 * directory; surfaced via a follow-up picker.
 * - `erd-layout` / `theme` / `keymap` / `health-config` → return parsed
 * payload to UI; FE-side stores apply.
 */
export function ShareImportPanel(): JSX.Element {
  const { t } = useTranslation();
  const previewFile = useFileSharing((s) => s.previewFile);
  const importFile = useFileSharing((s) => s.importFile);
  const preview = useFileSharing((s) => s.preview);
  const clearPreview = useFileSharing((s) => s.clearPreview);
  const applySnippet = useFileSharing((s) => s.applySnippet);
  const applySnippetBundle = useFileSharing((s) => s.applySnippetBundle);
  const applyQuery = useFileSharing((s) => s.applyQuery);
  const applyNotebook = useFileSharing((s) => s.applyNotebook);
  const applyMigrationSet = useFileSharing((s) => s.applyMigrationSet);
  const applyErdLayout = useFileSharing((s) => s.applyErdLayout);
  const applyTheme = useFileSharing((s) => s.applyTheme);
  const applyKeymap = useFileSharing((s) => s.applyKeymap);
  const applyHealthConfig = useFileSharing((s) => s.applyHealthConfig);

  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onPick = async () => {
    setError(null);
    setSuccess(null);
    setPicking(true);
    try {
      const picked = await openDialog({
        directory: false,
        multiple: false,
        filters: [{ name: ".ide99", extensions: ["ide99"] }],
      });
      const path =
        typeof picked === "string"
          ? picked
          : Array.isArray(picked) && typeof picked[0] === "string"
            ? picked[0]
            : null;
      if (!path) {
        setPicking(false);
        return;
      }
      setPickedPath(path);
      await previewFile(path);
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    } finally {
      setPicking(false);
    }
  };

  const dispatchApply = async (env: ShareEnvelope, kind: ShareKind): Promise<string> => {
    switch (kind) {
      case "snippet": {
        const n = await applySnippet(env.payload);
        return t("file_sharing.apply.success", { count: n });
      }
      case "snippet-bundle": {
        const n = await applySnippetBundle(env.payload);
        return t("file_sharing.apply.success", { count: n });
      }
      case "query": {
        await applyQuery(env.payload);
        return t("file_sharing.apply.success", { count: 1 });
      }
      case "notebook": {
        await applyNotebook(env.payload);
        return t("file_sharing.apply.success", { count: 1 });
      }
      case "migration-set": {
        const dest = await openDialog({ directory: true, multiple: false });
        if (typeof dest !== "string") {
          throw new Error(t("file_sharing.apply.error.no_dest"));
        }
        const n = await applyMigrationSet(env.payload, dest);
        return t("file_sharing.apply.success", { count: n });
      }
      case "erd-layout": {
        await applyErdLayout(env.payload);
        return t("file_sharing.apply.success", { count: 1 });
      }
      case "theme": {
        await applyTheme(env.payload);
        return t("file_sharing.apply.success", { count: 1 });
      }
      case "keymap": {
        await applyKeymap(env.payload);
        return t("file_sharing.apply.success", { count: 1 });
      }
      case "health-config": {
        await applyHealthConfig(env.payload);
        return t("file_sharing.apply.success", { count: 1 });
      }
      default:
        // connection / connection-bundle don't write through the file-sharing
        // pipeline — Connection Manager handles them via the parsed envelope.
        return t("file_sharing.apply.success", { count: 1 });
    }
  };

  const onApply = async () => {
    if (!preview || !pickedPath) return;
    setError(null);
    setSuccess(null);
    try {
      const env = await importFile(pickedPath);
      const msg = await dispatchApply(env, preview.kind);
      setSuccess(msg);
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    }
  };

  const onReset = () => {
    clearPreview();
    setPickedPath(null);
    setError(null);
    setSuccess(null);
  };

  const showActions = preview !== null;

  return (    <section
      data-testid="share-import-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 4,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.005em",
          }}
        >
          {t("file_sharing.import.title")}
        </h2>
      </header>

      <button
        type="button"
        className="btn btn-primary"
        style={{ alignSelf: "flex-start" }}
        onClick={() => void onPick()}
        disabled={picking}
        data-testid="share-import-pick"
      >
        {picking ? t("file_sharing.import.picking") : t("file_sharing.import.pick")}
      </button>

      {error ? (        <div
          role="alert"
          style={{
            color: "var(--danger-q, #f43f5e)",
            fontSize: 12,
            padding: "8px 10px",
            background: "var(--danger-q-soft, rgba(244, 63, 94, 0.08))",
            border: "1px solid var(--danger-q, #f43f5e)",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
) : null}
      {success ? (        <output
          data-testid="share-import-success"
          style={{
            color: "var(--accent-strong, var(--accent))",
            fontSize: 12,
            padding: "8px 10px",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
          }}
        >
          {success}
        </output>
) : null}

      {preview ? (        <section
          data-testid="share-import-preview"
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: 8,
            padding: "10px 12px",
            background: "var(--bg-sunken)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {t("file_sharing.import.kind")}:{" "}
            <code
              style={{
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                fontSize: 11,
                color: "var(--ink-2)",
                background: "var(--bg-elev)",
                padding: "1px 6px",
                borderRadius: 3,
                border: "1px solid var(--hairline)",
              }}
            >
              {preview.kind}
            </code>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink)" }}>{preview.summary}</div>
          {preview.mayCollide ? (            <div style={{ fontSize: 11, color: "var(--warn-q, #f59e0b)" }}>
              {t("file_sharing.import.may_collide")}
            </div>
) : null}
        </section>
) : null}

      {showActions ? (        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            paddingTop: 8,
            borderTop: "1px solid var(--hairline)",
          }}
        >
          <button type="button" className="btn" onClick={onReset} data-testid="share-import-cancel">
            {t("file_sharing.import.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onApply()}
            disabled={!preview}
            data-testid="share-import-apply"
          >
            {t("file_sharing.import.apply")}
          </button>
        </div>
) : null}
    </section>
);
}
