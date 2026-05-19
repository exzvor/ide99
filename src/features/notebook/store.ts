// — Notebook zustand store. Per-notebookId in-memory cache hooked
// up to the SQLite-backed IPC layer. scaffold: thin wrappers around
// `notebook_*` Tauri commands. extends with run-cell coordination
// (CTE compose → query_execute → persist result snapshot) and tracks
// per-cell run state used by SqlCell for the status pill.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { queryExecute } from "../../lib/tauri";
import type { Cell, ComposedSql, Notebook, SqlCell, UpsertNotebookInput } from "./types";

/**
 * Per-cell run state. Lives in the store rather than on the cell itself so
 * a render of one cell never blocks autosave (which serializes cells back
 * to disk). Keyed by `cellId`.
 */
export type CellRunState =
  | { status: "idle" }
  | { status: "running"; startedAt: number }
  | { status: "ok"; durationMs: number; ranAt: number }
  | { status: "error"; message: string; ranAt: number };

type NotebooksState = {
  byId: Record<string, Notebook>;
  loaded: boolean;
  /** Per-cell run state keyed by `cellId`. Driven by `runCell`. */
  runStateByCellId: Record<string, CellRunState>;
  /** Global "is this notebook running?" flag, keyed by notebookId. Used by
   * the autosave hook to suppress writes mid-run (race-risk: the result
   * snapshot is appended in-memory and we don't want a stale save to clobber it). */
  runningByNotebookId: Record<string, boolean>;

  hydrate: () => Promise<void>;
  load: (id: string) => Promise<Notebook | null>;
  save: (input: UpsertNotebookInput) => Promise<Notebook>;
  remove: (id: string) => Promise<void>;
  composeSql: (cells: Cell[], targetIdx: number) => Promise<ComposedSql>;
  exportFile: (notebook: Notebook, path: string) => Promise<void>;
  importFile: (path: string) => Promise<Notebook>;
  /**
   * Run an SQL cell. Composes share-as-CTE predecessors via
   * `notebook_compose_sql`, executes the resulting SQL through the existing
   * `query_execute` command, then persists the snapshot back into the
   * notebook (so reload restores results) and returns the updated notebook
   * for callers that prefer to drive React state explicitly.
   */
  runCell: (notebookId: string, cellId: string, connectionId: string) => Promise<Notebook | null>;
  /** Run every SQL cell from `startCellId` (or the first cell if undefined)
   * to the end, in order. Stops on the first error. */
  runFrom: (notebookId: string, startCellId: string | null, connectionId: string) => Promise<void>;
  /** Replace a notebook in cache (no IPC). Used by autosave + local edits
   * so the rest of the store stays consistent. */
  cache: (notebook: Notebook) => void;
};

export const useNotebooks = create<NotebooksState>((set, get) => ({
  byId: {},
  loaded: false,
  runStateByCellId: {},
  runningByNotebookId: {},

  hydrate: async () => {
    const all = await invoke<Notebook[]>("notebook_list");
    const byId: Record<string, Notebook> = {};
    for (const nb of all) {
      byId[nb.id] = nb;
    }
    set({ byId, loaded: true });
  },

  load: async (id) => {
    const cached = get().byId[id];
    if (cached) return cached;
    const nb = await invoke<Notebook | null>("notebook_get", { id });
    if (nb) {
      set({ byId: { ...get().byId, [nb.id]: nb } });
    }
    return nb;
  },

  save: async (input) => {
    const saved = await invoke<Notebook>("notebook_save", { input });
    set({ byId: { ...get().byId, [saved.id]: saved } });
    return saved;
  },

  remove: async (id) => {
    await invoke<void>("notebook_delete", { id });
    const next = { ...get().byId };
    delete next[id];
    set({ byId: next });
  },

  composeSql: async (cells, targetIdx) =>
    invoke<ComposedSql>("notebook_compose_sql", { cells, targetIdx }),

  exportFile: async (notebook, path) => {
    await invoke<void>("notebook_export_file", { notebook, path });
  },

  importFile: async (path) => {
    const nb = await invoke<Notebook>("notebook_import_file", { path });
    set({ byId: { ...get().byId, [nb.id]: nb } });
    return nb;
  },

  cache: (notebook) => {
    set({ byId: { ...get().byId, [notebook.id]: notebook } });
  },

  runCell: async (notebookId, cellId, connectionId) => {
    const nb = get().byId[notebookId];
    if (!nb) return null;
    const idx = nb.cells.findIndex((c) => c.id === cellId);
    if (idx < 0) return null;
    const cell = nb.cells[idx];
    if (!cell || cell.kind !== "sql") return null;

    set({
      runStateByCellId: {
        ...get().runStateByCellId,
        [cellId]: { status: "running", startedAt: Date.now() },
      },
      runningByNotebookId: { ...get().runningByNotebookId, [notebookId]: true },
    });

    try {
      const composed = await get().composeSql(nb.cells, idx);
      const startedAt = Date.now();
      const res = await queryExecute(connectionId, composed.sql);
      const durationMs = Date.now() - startedAt;
      const updated: SqlCell = {
        ...cell,
        result: {
          columns: res.columns.map((c) => c.name),
          rows: res.rows,
          truncated: res.truncated,
          durationMs: res.durationMs,
          executedAt: new Date().toISOString(),
        },
      };
      const nextCells = nb.cells.slice();
      nextCells[idx] = updated;
      const saved = await get().save({
        id: nb.id,
        name: nb.name,
        cells: nextCells,
        connectionId: nb.connectionId ?? null,
        filePath: nb.filePath ?? null,
      });
      set({
        runStateByCellId: {
          ...get().runStateByCellId,
          [cellId]: { status: "ok", durationMs, ranAt: Date.now() },
        },
        runningByNotebookId: { ...get().runningByNotebookId, [notebookId]: false },
      });
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        runStateByCellId: {
          ...get().runStateByCellId,
          [cellId]: { status: "error", message, ranAt: Date.now() },
        },
        runningByNotebookId: { ...get().runningByNotebookId, [notebookId]: false },
      });
      throw err;
    }
  },

  runFrom: async (notebookId, startCellId, connectionId) => {
    const nb = get().byId[notebookId];
    if (!nb) return;
    const startIdx = startCellId === null ? 0 : nb.cells.findIndex((c) => c.id === startCellId);
    if (startIdx < 0) return;
    for (let i = startIdx; i < nb.cells.length; i++) {
      const cell = nb.cells[i];
      if (!cell || cell.kind !== "sql") continue;
      try {
        await get().runCell(notebookId, cell.id, connectionId);
      } catch {
        // Stop the cascade on the first failure — the per-cell error is
        // already surfaced in `runStateByCellId`.
        return;
      }
    }
  },
}));
