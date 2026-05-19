/**
 * —
 *
 * Inline (non-modal) directory selector embedded in the panel header.
 * Two buttons:
 *
 * - Change… → `@tauri-apps/plugin-dialog::open({ directory: true })`
 * then `migrations_set_dir`.
 * - Clear   → `migrations_clear_dir`.
 *
 * The component is stateless w.r.t. the directory itself — `currentDir`
 * is owned by the panel (zustand store) and the parent `onChanged`
 * callback persists the new value back into state.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorToMessage } from "../../lib/errors";

interface Props {
  connectionId: string;
  currentDir: string | null;
  onChanged(dir: string | null): void;
}

export function DirectorySelector(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { connectionId, currentDir, onChanged } = props;
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const picked = (await openDialog({
        directory: true,
        multiple: false,
      })) as string | string[] | null;
      if (picked == null) return; // user cancelled
      const dir = Array.isArray(picked) ? picked[0] : picked;
      if (!dir) return;
      await invoke("migrations_set_dir", { connId: connectionId, dir });
      onChanged(dir);
    } catch (err) {
      setError(errorToMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await invoke("migrations_clear_dir", { connId: connectionId });
      onChanged(null);
    } catch (err) {
      setError(errorToMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="directory-selector"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        fontSize: 13,
        color: "var(--ink-2)",
      }}
    >
      <span style={{ color: "var(--ink-3)" }}>{t("migrations.panel.directory")}:</span>
      <span
        data-testid="directory-selector-current"
        style={{
          fontFamily: "var(--font-mono-q)",
          color: currentDir ? "var(--ink-2)" : "var(--ink-4)",
        }}
      >
        {currentDir ?? t("migrations.panel.directoryNotSet")}
      </span>
      <button
        type="button"
        data-testid="directory-selector-change"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => {
          void handleChange();
        }}
        aria-label={t("migrations.selector.openDialog")}
      >
        {t("migrations.panel.change")}
      </button>
      {currentDir ? (
        <button
          type="button"
          data-testid="directory-selector-clear"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            void handleClear();
          }}
        >
          {t("migrations.panel.clear")}
        </button>
      ) : null}
      {error ? (
        <span role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
