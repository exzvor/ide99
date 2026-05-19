import type { JsonbDiff, RowKey } from "../../../lib/tauri";

export type ViewMode = "text" | "tree" | "table";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "saved"; affectedRows: number; durationMs: number };

export interface JsonbEditorOpenArgs {
  /** Editor tab the cell came from — used to look up connection + sql + row. */
  tabId: string;
  /** 0-based row index in the streaming result. */
  rowIdx: number;
  /** 0-based source-column index (matches `run.columns[srcIdx]`). */
  srcColIdx: number;
}

export interface JsonbEditorState {
  open: boolean;
  args: JsonbEditorOpenArgs | null;
  /** Authoritative original value as a JSON string. */
  original: string;
  /** Current draft value as a JSON string. */
  draft: string;
  /** Last successful parse of `draft` — null when text-mode JSON is invalid. */
  draftParsed: unknown;
  /** Parse error message for text-mode invalid JSON. */
  draftParseError: string | null;
  /** Live diff vs. `original`. Recomputed on every draft change. */
  diff: JsonbDiff;
  mode: ViewMode;
  rowKey: RowKey | null;
  /** Connection environment label snapshot — drives prod-confirm flow. */
  envIsProd: boolean;
  /** "schema.table" string used for the confirm-by-typing match. */
  fqTableName: string | null;
  status: SaveStatus;
}
