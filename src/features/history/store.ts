/**
 * — Query History store.
 *
 * Zustand state machine for the History tab. Filters drive a server-side
 * `history_search` IPC; results paginate via `lastFetchOffset`. The store
 * owns:
 * - filter shape (search query, connection, status, pinned-only, date range)
 * - the current rows + total-matched + load state
 * - pin / delete / clear-for-connection / export operations
 *
 * `setFilter` does NOT auto-refresh — `HistoryTab` debounces calls. This
 * keeps the store predictable in tests and lets the UI batch typed
 * keystrokes through a single 250ms timer.
 *
 * Export uses `@tauri-apps/plugin-dialog` to surface the OS save panel,
 * then hands the chosen path to the Rust `history_export` command which
 * streams rows to disk as JSON. Cancellation returns silently.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import {
  type HistoryRow,
  type HistorySearchFilter,
  type HistoryStatus,
  historyClearForConnection,
  historyDelete,
  historyExport,
  historySearch,
  historySetPinned,
} from "../../lib/tauri";

export interface HistoryFilters {
  query: string;
  connectionId: string | null;
  status: HistoryStatus | null;
  pinnedOnly: boolean;
  since: string | null;
  until: string | null;
}

export interface HistoryState {
  filters: HistoryFilters;
  rows: HistoryRow[];
  totalMatched: number;
  loading: boolean;
  error: string | null;
  lastFetchOffset: number;
  setFilter<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]): void;
  resetFilters(): void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  clearForConnection(connId: string): Promise<void>;
  exportToFile(): Promise<
    { ok: true; path: string; count: number } | { ok: false; cancelled: boolean; error?: string }
  >;
}

export const DEFAULT_FILTERS: HistoryFilters = {
  query: "",
  connectionId: null,
  status: null,
  pinnedOnly: false,
  since: null,
  until: null,
};

const PAGE_SIZE = 200;

/**
 * Sanitize a free-form FTS5 search query so a stray `*` / unbalanced quote
 * never produces a "fts5: syntax error near …" panic in SQLite. Each token
 * is wrapped in double quotes and joined by whitespace (FTS5 implicit AND).
 *
 * Returns null when the query has no useful tokens — callers should pass
 * null to the IPC, which interprets it as "no full-text filter".
 */
export function sanitizeFtsQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter((t) => /[\p{L}\p{N}_]/u.test(t));
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(" ");
}

function buildSearchFilter(  filters: HistoryFilters,
  offset: number,
  limit: number,
): HistorySearchFilter {
  return {
    query: sanitizeFtsQuery(filters.query),
    connectionId: filters.connectionId,
    status: filters.status,
    pinnedOnly: filters.pinnedOnly,
    since: filters.since,
    until: filters.until,
    limit,
    offset,
  };
}

export const useHistory = create<HistoryState>((set, get) => ({
  filters: { ...DEFAULT_FILTERS },
  rows: [],
  totalMatched: 0,
  loading: false,
  error: null,
  lastFetchOffset: 0,

  setFilter: (key, value) => {
    set((state) => ({ filters: { ...state.filters, [key]: value } }));
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
  },

  refresh: async () => {
    set({ loading: true, error: null });
    const filter = buildSearchFilter(get().filters, 0, PAGE_SIZE);
    try {
      const result = await historySearch(filter);
      set({
        rows: result.rows,
        totalMatched: result.totalMatched,
        lastFetchOffset: 0,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  loadMore: async () => {
    const state = get();
    if (state.loading) return;
    if (state.rows.length >= state.totalMatched) return;
    set({ loading: true });
    const filter = buildSearchFilter(state.filters, state.rows.length, PAGE_SIZE);
    try {
      const result = await historySearch(filter);
      const prevRows = get().rows;
      const merged = [...prevRows, ...result.rows];
      set({
        rows: merged,
        totalMatched: result.totalMatched,
        lastFetchOffset: prevRows.length,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setPinned: async (id, pinned) => {
    await historySetPinned(id, pinned);
    set((state) => ({
      rows: state.rows.map((row) => (row.id === id ? { ...row, pinned } : row)),
    }));
  },

  remove: async (id) => {
    await historyDelete(id);
    set((state) => {
      const existed = state.rows.some((r) => r.id === id);
      return {
        rows: state.rows.filter((r) => r.id !== id),
        totalMatched: existed ? Math.max(0, state.totalMatched - 1) : state.totalMatched,
      };
    });
  },

  clearForConnection: async (connId) => {
    await historyClearForConnection(connId);
    const filterConn = get().filters.connectionId;
    if (filterConn === null || filterConn === connId) {
      await get().refresh();
    }
  },

  exportToFile: async () => {
    let chosenPath: string | null;
    try {
      chosenPath = await save({
        filters: [{ name: "ide99 history", extensions: ["ide99"] }],
        defaultPath: "history.ide99",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false as const, cancelled: false, error: message };
    }
    if (chosenPath === null || chosenPath === undefined) {
      return { ok: false as const, cancelled: true };
    }
    const filter = buildSearchFilter(get().filters, 0, PAGE_SIZE);
    try {
      const result = await historyExport(filter, chosenPath);
      return { ok: true as const, path: result.path, count: result.count };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false as const, cancelled: false, error: message };
    }
  },
}));
