// — Recent Plans browser store.
//
// Owns the data backing the Recent Plans tab: filtered list, total count,
// current filter, and selection. Actions wrap the IPC layer (recent_plans_*
// commands) and refresh the canonical list after every mutation so pinned /
// deleted rows reflect immediately. setFilter is intentionally non-reactive
// — UI debounces input changes itself and calls refresh() explicitly so we
// don't fire a search per keystroke.

import { create } from "zustand";
import {
  type RecentPlanRow,
  type RecentPlansFilter,
  recentPlansDelete,
  recentPlansSearch,
  recentPlansSetPinned,
} from "../../lib/tauri";
import { useEditor } from "../editor/store";

const DEFAULT_FILTER: RecentPlansFilter = { limit: 50, offset: 0 };

export interface RecentPlansState {
  rows: RecentPlanRow[];
  total: number;
  loading: boolean;
  error: string | null;
  filter: RecentPlansFilter;
  selectedId: string | null;
  /** — compare mode toggles checkboxes on rows for picking
   * exactly two plans to diff. */
  compareMode: boolean;
  /** — at most 2 row ids; FIFO eviction at 3rd toggle. */
  compareSelected: string[];
  /** Merge `patch` into the filter and reset offset to 0. Does NOT
   * auto-refresh — caller must invoke `refresh()` explicitly (UI debounces
   * keystroke-driven changes). */
  setFilter(patch: Partial<RecentPlansFilter>): void;
  /** Fetch from offset=0 with the current filter. Replaces `rows`. */
  refresh(): Promise<void>;
  /** Append the next page (offset = current rows.length). No-op when
   * already exhausted. */
  loadMore(): Promise<void>;
  selectRow(id: string | null): void;
  /** Round-trip through IPC then refresh — keeps the list canonical
   * (e.g. pin order propagates server-side). */
  togglePinned(id: string): Promise<void>;
  /** Round-trip through IPC, clear selection if it pointed at the deleted
   * row, then refresh. */
  deleteRow(id: string): Promise<void>;
  /** — flip compareMode; clears compareSelected when leaving. */
  toggleCompareMode(): void;
  /** — toggle id in compareSelected with FIFO eviction at the 3rd
   * pick (drop oldest). */
  toggleCompareSelected(id: string): void;
  /** — drop everything from compareSelected without leaving mode. */
  clearCompareSelected(): void;
  /** — spawn a PlanDiffTab from the two selected ids. No-op
   * when count !== 2. Filled in by . */
  startCompare(): void;
  reset(): void;
}

export const useRecentPlans = create<RecentPlansState>((set, get) => ({
  rows: [],
  total: 0,
  loading: false,
  error: null,
  filter: DEFAULT_FILTER,
  selectedId: null,
  compareMode: false,
  compareSelected: [],

  setFilter: (patch) => {
    set({ filter: { ...get().filter, ...patch, offset: 0 } });
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const filter = { ...get().filter, offset: 0 };
      const res = await recentPlansSearch(filter);
      // — drop compareSelected ids that no longer exist in the
      // result set so the compare-bar UI never shows stale picks.
      const validIds = new Set(res.rows.map((r) => r.id));
      const compareSelected = get().compareSelected.filter((id) => validIds.has(id));
      set({ rows: res.rows, total: res.total, filter, loading: false, compareSelected });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadMore: async () => {
    const { filter, rows, total } = get();
    if (rows.length >= total) return;
    set({ loading: true, error: null });
    try {
      const nextFilter = { ...filter, offset: rows.length };
      const res = await recentPlansSearch(nextFilter);
      set({
        rows: [...rows, ...res.rows],
        total: res.total,
        filter: nextFilter,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  selectRow: (id) => set({ selectedId: id }),

  togglePinned: async (id) => {
    const row = get().rows.find((r) => r.id === id);
    if (!row) return;
    await recentPlansSetPinned(id, !row.pinned);
    await get().refresh();
  },

  deleteRow: async (id) => {
    await recentPlansDelete(id);
    if (get().selectedId === id) set({ selectedId: null });
    await get().refresh();
  },

  toggleCompareMode: () => {
    const next = !get().compareMode;
    set({ compareMode: next, compareSelected: next ? get().compareSelected : [] });
  },

  toggleCompareSelected: (id) => {
    const cur = get().compareSelected;
    if (cur.includes(id)) {
      set({ compareSelected: cur.filter((x) => x !== id) });
      return;
    }
    if (cur.length < 2) {
      set({ compareSelected: [...cur, id] });
      return;
    }
    // FIFO at 3rd selection — drop oldest, keep most recent two.
    set({ compareSelected: [cur[1], id] });
  },

  clearCompareSelected: () => set({ compareSelected: [] }),

  startCompare: () => {
    const selected = get().compareSelected;
    if (selected.length !== 2) return;
    const [aId, bId] = selected;
    useEditor
      .getState()
      .openPlanDiff({ kind: "recent", recentPlanId: aId }, { kind: "recent", recentPlanId: bId });
    // Exit compare mode (toggleCompareMode also clears compareSelected).
    get().toggleCompareMode();
  },

  reset: () =>
    set({
      rows: [],
      total: 0,
      loading: false,
      error: null,
      filter: DEFAULT_FILTER,
      selectedId: null,
      compareMode: false,
      compareSelected: [],
    }),
}));
