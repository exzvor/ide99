/**
 * Notebook tab body.
 *
 * Lazy-loads the notebook (creates a fresh one if load returns null),
 * renders the toolbar (rename / save-as / open) and `CellList`. Autosave
 * via `useAutosave` persists state 500 ms after an edit.
 */
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { type JSX, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { NotebookTab } from "../editor/store";
import { CellList } from "./CellList";
import { useNotebooks } from "./store";
import type { Notebook } from "./types";
import { useAutosave } from "./useAutosave";

export function NotebookPane({ tab }: { tab: NotebookTab }): JSX.Element {
  const { t } = useTranslation();
  const load = useNotebooks((s) => s.load);
  const save = useNotebooks((s) => s.save);
  const exportFile = useNotebooks((s) => s.exportFile);
  const importFile = useNotebooks((s) => s.importFile);
  const cache = useNotebooks((s) => s.cache);

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await load(tab.notebookId);
      if (cancelled) return;
      if (existing) {
        setNotebook(existing);
      } else {
        const fresh = await save({
          id: tab.notebookId,
          name: t("notebook.untitled"),
          cells: [],
          connectionId: tab.connectionId,
        });
        if (!cancelled) setNotebook(fresh);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.notebookId, tab.connectionId, load, save, t]);

  // Subscribe the store cache to local edits so other consumers
  // (run-cell, autosave) stay consistent.
  useEffect(() => {
    if (notebook) cache(notebook);
  }, [notebook, cache]);

  const autosave = useAutosave(notebook);

  const onChange = useCallback((next: Notebook) => {
    setNotebook(next);
  }, []);

  const onRename = useCallback((name: string) => {
    setNotebook((prev) => (prev ? { ...prev, name } : prev));
  }, []);

  const onSaveNow = useCallback(async () => {
    if (!notebook) return;
    setOpError(null);
    try {
      const saved = await save({
        id: notebook.id,
        name: notebook.name,
        cells: notebook.cells,
        connectionId: notebook.connectionId ?? null,
        filePath: notebook.filePath ?? null,
      });
      setNotebook(saved);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  }, [notebook, save]);

  const onSaveAs = useCallback(async () => {
    if (!notebook) return;
    setOpError(null);
    try {
      const path = await saveDialog({
        title: t("notebook.dialog.save_as_title"),
        defaultPath: `${notebook.name}.ide99nb`,
        filters: [{ name: "ide99 notebook", extensions: ["ide99nb", "json"] }],
      });
      if (!path) return;
      await exportFile(notebook, path);
      const next = { ...notebook, filePath: path };
      setNotebook(next);
      // Persist the filePath link so future Save knows the bound location.
      await save({
        id: next.id,
        name: next.name,
        cells: next.cells,
        connectionId: next.connectionId ?? null,
        filePath: path,
      });
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  }, [notebook, t, exportFile, save]);

  const onOpen = useCallback(async () => {
    setOpError(null);
    try {
      const path = await openDialog({
        title: t("notebook.dialog.open_title"),
        multiple: false,
        filters: [{ name: "ide99 notebook", extensions: ["ide99nb", "json"] }],
      });
      if (!path || Array.isArray(path)) return;
      const imported = await importFile(path);
      setNotebook(imported);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  }, [t, importFile]);

  if (!notebook) {
    return <div style={{ padding: 16, color: "var(--muted, #888)" }}>{t("notebook.loading")}</div>;
  }

  const autosaveLabel =
    autosave.status === "saving"
      ? t("notebook.autosave.saving")
      : autosave.status === "pending"
        ? t("notebook.autosave.pending")
        : autosave.status === "saved"
          ? t("notebook.autosave.saved")
          : autosave.status === "error"
            ? t("notebook.autosave.error")
            : null;

  return (    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "auto",
      }}
      data-testid="notebook-pane"
    >
      <header
        style={{
          padding: "10px 16px",
          display: "flex",
          gap: 8,
          alignItems: "center",
          borderBottom: "1px solid var(--hairline)",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          data-testid="notebook-name"
          aria-label={t("notebook.field.name")}
          value={notebook.name}
          onChange={(e) => onRename(e.target.value)}
          style={{
            fontSize: 14,
            fontWeight: 600,
            background: "var(--bg)",
            color: "var(--fg)",
            border: "1px solid transparent",
            padding: "4px 6px",
            minWidth: 200,
            flex: "0 1 auto",
          }}
        />
        <button
          type="button"
          data-testid="notebook-save"
          onClick={() => void onSaveNow()}
          aria-label={t("notebook.action.save")}
          className="btn btn-ghost"
        >
          {t("notebook.action.save")}
        </button>
        <button
          type="button"
          data-testid="notebook-save-as"
          onClick={() => void onSaveAs()}
          aria-label={t("notebook.action.save_as")}
          className="btn btn-ghost"
        >
          {t("notebook.action.save_as")}
        </button>
        <button
          type="button"
          data-testid="notebook-open"
          onClick={() => void onOpen()}
          aria-label={t("notebook.action.open")}
          className="btn btn-ghost"
        >
          {t("notebook.action.open")}
        </button>
        {autosaveLabel ? (          <span
            data-testid="notebook-autosave-status"
            style={{ fontSize: 11, color: "var(--muted, #888)", marginLeft: "auto" }}
          >
            {autosaveLabel}
          </span>
) : null}
      </header>
      {opError ? (        <div
          data-testid="notebook-op-error"
          role="alert"
          style={{ padding: "6px 16px", fontSize: 12, color: "var(--err, #d33)" }}
        >
          {opError}
        </div>
) : null}
      <CellList notebook={notebook} onChange={onChange} connectionId={tab.connectionId} />
    </div>
);
}
