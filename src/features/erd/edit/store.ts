import { create } from "zustand";
import type { AstWarning } from "./applyAstChanges";
import type { Op } from "./ops";

type Mode = "read" | "edit";

export interface AstParseError {
  message: string;
  line: number;
  column: number;
}

interface TabState {
  ops: Op[];
  past: Op[][]; // snapshots before each push (for undo)
  future: Op[][]; // snapshots cleared on push, populated on undo (for redo)
  mode: Mode;
  // S20 — surfaced to DdlPreviewPanel; do NOT push these into past/future
  // (the SQL editor is the source of truth in reverse direction, undo here
  // would be confusing).
  astWarnings: AstWarning[];
  astParseError: AstParseError | null;
  /**
   * S20 fix — when the user is typing in the DDL panel (text edit
   * drives ops via reverse-parse), the forward effect MUST NOT regenerate
   * DDL from `ops` and overwrite the user's text. Forward fires only when
   * the most recent change was a visual canvas op (`pushOp`).
   *
   * Values:
   * - "visual": last change came from `pushOp` (canvas drag, +column, etc.)
   * - "text":   last change came from `replaceOpsFromAst` (Monaco edit)
   * - null:     no edit yet OR ops fully discarded
   */
  lastChangeBy: "visual" | "text" | null;
  /**
   * S20 fix — verbatim Monaco text captured at the moment of the
   * last successful reverse parse. Apply uses this when `lastChangeBy
   * === "text"` so unrepresentable statements (CREATE INDEX, etc.) and
   * statement order survive the round-trip.
   */
  lastReverseText: string | null;
}

interface EditStoreState {
  tabs: Map<string, TabState>;
  getOps(tabId: string): Op[];
  getMode(tabId: string): Mode;
  isDirty(tabId: string): boolean;
  canUndo(tabId: string): boolean;
  canRedo(tabId: string): boolean;
  pushOp(tabId: string, op: Op): void;
  undo(tabId: string): void;
  redo(tabId: string): void;
  discard(tabId: string): void;
  toggleMode(tabId: string): void;
  setMode(tabId: string, mode: Mode): void;
  clearTab(tabId: string): void;
  reset(): void;
  // S20 — bidirectional reverse projection
  getAstWarnings(tabId: string): AstWarning[];
  getAstParseError(tabId: string): AstParseError | null;
  /**
   * S20 — apply a list of ops derived from a successful reverse parse and
   * remember the verbatim text the user typed. Sets `lastChangeBy = "text"`
   * so the forward effect won't echo a regenerated DDL back into Monaco.
   */
  replaceOpsFromAst(tabId: string, ops: Op[], warnings: AstWarning[], sourceText: string): void;
  setAstParseError(tabId: string, err: AstParseError | null): void;
  clearAstWarnings(tabId: string): void;
  /** S20 �� the readers used by ErdPane / DdlPreviewPanel. */
  getLastChangeBy(tabId: string): "visual" | "text" | null;
  getLastReverseText(tabId: string): string | null;
}

const EMPTY_TAB: TabState = {
  ops: [],
  past: [],
  future: [],
  mode: "read",
  astWarnings: [],
  astParseError: null,
  lastChangeBy: null,
  lastReverseText: null,
};

export const useEditStore = create<EditStoreState>((set, get) => ({
  tabs: new Map(),

  getOps: (tabId) => get().tabs.get(tabId)?.ops ?? [],
  getMode: (tabId) => get().tabs.get(tabId)?.mode ?? "read",
  isDirty: (tabId) => (get().tabs.get(tabId)?.ops.length ?? 0) > 0,
  canUndo: (tabId) => (get().tabs.get(tabId)?.past.length ?? 0) > 0,
  canRedo: (tabId) => (get().tabs.get(tabId)?.future.length ?? 0) > 0,

  pushOp: (tabId, op) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId) ?? { ...EMPTY_TAB, past: [], future: [], ops: [] };
    // moveTable coalescing: replace last op if it's the same kind on same table.
    const lastOp = cur.ops[cur.ops.length - 1];
    let nextOps: Op[];
    let nextPast: Op[][];
    if (      op.kind === "moveTable" &&
      lastOp?.kind === "moveTable" &&
      sameTableRef(op.table, lastOp.table)
) {
      nextOps = [...cur.ops.slice(0, -1), op];
      nextPast = cur.past; // do not extend undo history for coalesced moves
    } else {
      nextOps = [...cur.ops, op];
      nextPast = [...cur.past, cur.ops];
    }
    tabs.set(tabId, {
      ...cur,
      ops: nextOps,
      past: nextPast,
      future: [],
      // S20 visual op → forward effect should regenerate DDL.
      lastChangeBy: "visual",
      lastReverseText: null,
    });
    set({ tabs });
  },

  undo: (tabId) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId);
    if (!cur || cur.past.length === 0) return;
    const prev = cur.past[cur.past.length - 1];
    tabs.set(tabId, {
      ...cur,
      ops: prev,
      past: cur.past.slice(0, -1),
      future: [...cur.future, cur.ops],
    });
    set({ tabs });
  },

  redo: (tabId) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId);
    if (!cur || cur.future.length === 0) return;
    const next = cur.future[cur.future.length - 1];
    tabs.set(tabId, {
      ...cur,
      ops: next,
      past: [...cur.past, cur.ops],
      future: cur.future.slice(0, -1),
    });
    set({ tabs });
  },

  discard: (tabId) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId);
    if (!cur) return;
    tabs.set(tabId, {
      ...cur,
      ops: [],
      past: [],
      future: [],
      // S20 discard wipes the bidirectional state too.
      astWarnings: [],
      astParseError: null,
      lastChangeBy: null,
      lastReverseText: null,
    });
    set({ tabs });
  },

  toggleMode: (tabId) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId) ?? { ...EMPTY_TAB };
    tabs.set(tabId, { ...cur, mode: cur.mode === "read" ? "edit" : "read" });
    set({ tabs });
  },

  setMode: (tabId, mode) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId) ?? { ...EMPTY_TAB };
    tabs.set(tabId, { ...cur, mode });
    set({ tabs });
  },

  clearTab: (tabId) => {
    const tabs = new Map(get().tabs);
    tabs.delete(tabId);
    set({ tabs });
  },

  reset: () => set({ tabs: new Map() }),

  getAstWarnings: (tabId) => get().tabs.get(tabId)?.astWarnings ?? [],
  getAstParseError: (tabId) => get().tabs.get(tabId)?.astParseError ?? null,

  replaceOpsFromAst: (tabId, ops, warnings, sourceText) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId) ?? { ...EMPTY_TAB };
    tabs.set(tabId, {
      ...cur,
      // The SQL editor is the source-of-truth in reverse direction; we
      // replace the ops list wholesale and snapshot the previous state into
      // `past` so the user can still ⌘Z back into pre-paste/pre-edit ops.
      ops,
      past: [...cur.past, cur.ops],
      future: [],
      astWarnings: warnings,
      astParseError: null,
      // S20 fix: text is the source of truth from now on. Forward
      // effect must NOT regenerate DDL until the user makes a visual op.
      lastChangeBy: "text",
      lastReverseText: sourceText,
    });
    set({ tabs });
  },

  setAstParseError: (tabId, err) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId) ?? { ...EMPTY_TAB };
    tabs.set(tabId, { ...cur, astParseError: err });
    set({ tabs });
  },

  clearAstWarnings: (tabId) => {
    const tabs = new Map(get().tabs);
    const cur = tabs.get(tabId) ?? { ...EMPTY_TAB };
    tabs.set(tabId, { ...cur, astWarnings: [], astParseError: null });
    set({ tabs });
  },

  getLastChangeBy: (tabId) => get().tabs.get(tabId)?.lastChangeBy ?? null,
  getLastReverseText: (tabId) => get().tabs.get(tabId)?.lastReverseText ?? null,
}));

function sameTableRef(  a: { schema: string; name: string } | { _new: string },
  b: { schema: string; name: string } | { _new: string },
): boolean {
  if ("_new" in a && "_new" in b) return a._new === b._new;
  if ("_new" in a || "_new" in b) return false;
  return a.schema === b.schema && a.name === b.name;
}
