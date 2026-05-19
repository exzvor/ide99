import { create } from "zustand";
import {
  type JsonbDiff,
  type JsonbWriteContext,
  jsonbResolveRowKey,
  jsonbSave,
} from "../../../lib/tauri";
import { useConnections } from "../../connections/store";
import { useEditor } from "../../editor/store";
import { computeDiff } from "../diff/computeDiff";
import type { JsonbEditorOpenArgs, JsonbEditorState } from "./types";

const EMPTY_DIFF: JsonbDiff = { ops: [], fullReplace: false };

const INITIAL: JsonbEditorState = {
  open: false,
  args: null,
  original: "",
  draft: "",
  draftParsed: null,
  draftParseError: null,
  diff: EMPTY_DIFF,
  mode: "tree",
  rowKey: null,
  envIsProd: false,
  fqTableName: null,
  status: { kind: "idle" },
};

interface Actions {
  /** Opens the modal for the given cell. Loads the original value, resolves
   * the row key + environment + fully-qualified table name. (Renamed from
   * `open` to avoid colliding with the boolean state field of the same
   * name.) */
  openEditor: (args: JsonbEditorOpenArgs, originalValue: string) => Promise<void>;
  close: () => void;
  setDraft: (next: string) => void;
  setMode: (mode: JsonbEditorState["mode"]) => void;
  /** Persist the draft. `confirmedTableName` is the typed-back FQ name from
   * the prod-confirm modal; pass `null` for non-prod connections. */
  save: (confirmedTableName: string | null) => Promise<void>;
}

function safeParse(s: string): { value: unknown; error: string | null } {
  try {
    return { value: JSON.parse(s), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : "invalid JSON" };
  }
}

/** Format a Tauri error envelope for the toast. The wire shape is
 * `{ kind: 'camelCaseVariant', ...payload }` (serde tag on QueryError);
 * plain `String(e)` on those gives `"[object Object]"`. */
function formatTauriError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const kind = typeof o.kind === "string" ? o.kind : null;
    if (kind === "postgresError" && typeof o.message === "string") return o.message;
    if (kind === "jsonbParseError" && typeof o.message === "string")
      return `JSON parse error: ${o.message}`;
    if (kind === "productionGuardFailed") {
      const expected = typeof o.expected === "string" ? o.expected : "?";
      const received = typeof o.received === "string" ? o.received : "(none)";
      return `Production guard: expected "${expected}", got "${received}"`;
    }
    if (kind === "rowVanished") return "Row not found — concurrent delete?";
    if (kind === "readOnlyResult") {
      const reason = typeof o.reason === "string" ? o.reason : "unknown";
      return `Read-only result (${reason})`;
    }
    if (kind === "notConnected") return "Connection is not active";
    if (kind === "cursorNotFound") return "Cursor not found (result expired?)";
    if (kind === "cancelled") return "Cancelled";
    if (kind === "poolError" && typeof o.message === "string") return `Pool error: ${o.message}`;
    if (kind === "storageError" && typeof o.message === "string")
      return `Storage error: ${o.message}`;
    if (kind) return kind;
    if (typeof o.message === "string") return o.message;
    try {
      return JSON.stringify(e);
    } catch {
      // unrepresentable — fall through to the String() fallback below
    }
  }
  return String(e);
}

export const useJsonbEditor = create<JsonbEditorState & Actions>((set, get) => ({
  ...INITIAL,

  openEditor: async (args, originalValue) => {
    const parsed = safeParse(originalValue);
    set({
      open: true,
      args,
      original: originalValue,
      draft: originalValue,
      draftParsed: parsed.value,
      draftParseError: parsed.error,
      diff: EMPTY_DIFF,
      mode: "tree",
      rowKey: null,
      envIsProd: false,
      fqTableName: null,
      status: { kind: "idle" },
    });

    const editor = useEditor.getState();
    const tab = editor.tabs.find((t) => t.id === args.tabId);
    if (!tab || tab.kind !== "editor") return;

    const run = editor.runStates.get(args.tabId);
    if (!run || run.status !== "streaming") return;

    const conn = tab.connectionId
      ? useConnections.getState().connections.find((c) => c.id === tab.connectionId)
      : null;
    const envIsProd = conn?.environment === "prod";
    const rowValues = run.rows[args.rowIdx] ?? null;
    if (!rowValues) return;

    try {
      const rowKey = await jsonbResolveRowKey({
        connId: tab.connectionId ?? "",
        cursorId: run.cursorId ?? "",
        rowIdx: args.rowIdx,
        rowValues,
      });
      const fqTableName =
        rowKey.kind === "pk" || rowKey.kind === "ctid" ? `${rowKey.schema}.${rowKey.table}` : null;
      set({ rowKey, envIsProd, fqTableName });
    } catch (e) {
      const msg = formatTauriError(e);
      set({
        envIsProd,
        rowKey: { kind: "readOnly", reason: "noColumnMetadata" },
        status: { kind: "error", message: msg },
      });
    }
  },

  close: () => set({ ...INITIAL }),

  setDraft: (next) => {
    const { original } = get();
    const parsed = safeParse(next);
    const origParsed = safeParse(original);
    const diff =
      parsed.error === null && origParsed.error === null
        ? computeDiff(origParsed.value, parsed.value)
        : EMPTY_DIFF;
    set({
      draft: next,
      draftParsed: parsed.value,
      draftParseError: parsed.error,
      diff,
    });
  },

  setMode: (mode) => set({ mode }),

  save: async (confirmedTableName) => {
    const s = get();
    const args = s.args;
    if (!args || !s.rowKey) return;
    if (s.rowKey.kind === "readOnly") return;
    if (s.draftParseError) return;

    set({ status: { kind: "saving" } });

    const editor = useEditor.getState();
    const tab = editor.tabs.find((t) => t.id === args.tabId);
    if (!tab || tab.kind !== "editor" || !tab.connectionId) {
      set({ status: { kind: "error", message: "tab not found or unconnected" } });
      return;
    }

    const run = editor.runStates.get(args.tabId);
    const columnName =
      run && run.status === "streaming" ? (run.columns[args.srcColIdx]?.name ?? "") : "";

    const ctx: JsonbWriteContext = {
      connId: tab.connectionId,
      rowKey: s.rowKey,
      column: columnName,
      oldValue: s.original,
      newValue: s.draft,
      confirmedTableName,
    };

    try {
      const r = await jsonbSave(ctx);
      // Patch the in-memory ResultGrid so the user sees the new value
      // without re-running the query.
      editor.patchRowCell(args.tabId, args.rowIdx, args.srcColIdx, r.newCellValue);
      set({
        status: { kind: "saved", affectedRows: r.affectedRows, durationMs: r.durationMs },
      });
      // Auto-close after a short toast window.
      setTimeout(() => {
        // Only close if we're still in the "saved" status — bail if a new
        // edit started in the interim.
        const cur = get();
        if (cur.status.kind === "saved") {
          set({ ...INITIAL });
        }
      }, 600);
    } catch (e) {
      const msg = formatTauriError(e);
      set({ status: { kind: "error", message: msg } });
    }
  },
}));

// Re-export for tests / export { EMPTY_DIFF };
