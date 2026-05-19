/**
 * — Notebook autosave hook.
 *
 * Watches a notebook reference and persists changes to SQLite via
 * `notebook_save` 500 ms after the last edit. Suppresses saves while the
 * notebook is mid-run to avoid clobbering the in-flight result snapshot
 * with a stale pre-run state (the run-cell action saves on its own).
 *
 * Returns `{ status, lastSavedAt }` for an unobtrusive header indicator
 * («Saving…», «Saved 2 s ago»).
 */
import { useEffect, useRef, useState } from "react";

import { useNotebooks } from "./store";
import type { Notebook } from "./types";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export type AutosaveResult = {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  errorMessage: string | null;
};

export function useAutosave(  notebook: Notebook | null,
  options: { delayMs?: number; enabled?: boolean } = {},
): AutosaveResult {
  const delayMs = options.delayMs ?? 500;
  const enabled = options.enabled ?? true;
  const save = useNotebooks((s) => s.save);
  const isRunning = useNotebooks((s) =>
    notebook ? s.runningByNotebookId[notebook.id] === true : false,
);

  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastSerializedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !notebook) return;
    if (isRunning) return;
    const serialized = JSON.stringify({
      name: notebook.name,
      cells: notebook.cells,
      connectionId: notebook.connectionId ?? null,
      filePath: notebook.filePath ?? null,
    });
    if (lastSerializedRef.current === null) {
      // First mount — treat the loaded value as already-saved so an
      // immediate render doesn't trigger a redundant write.
      lastSerializedRef.current = serialized;
      return;
    }
    if (lastSerializedRef.current === serialized) return;

    setStatus("pending");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await save({
          id: notebook.id,
          name: notebook.name,
          cells: notebook.cells,
          connectionId: notebook.connectionId ?? null,
          filePath: notebook.filePath ?? null,
        });
        lastSerializedRef.current = serialized;
        setLastSavedAt(Date.now());
        setStatus("saved");
        setErrorMessage(null);
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [notebook, enabled, isRunning, delayMs, save]);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { status, lastSavedAt, errorMessage };
}
