// Notebook DTOs — mirror src-tauri/src/notebook/types.rs (camelCase via serde).

export type CellResult = {
  columns: string[];
  rows: Array<Array<string | null>>;
  truncated: boolean;
  durationMs: number;
  executedAt: string;
};

export type SqlCell = {
  kind: "sql";
  id: string;
  source: string;
  result?: CellResult;
  shareAsCte?: boolean;
  cteName?: string;
};

export type MarkdownCell = {
  kind: "markdown";
  id: string;
  source: string;
};

export type ResultCell = {
  kind: "result";
  id: string;
  result: CellResult;
};

export type Cell = SqlCell | MarkdownCell | ResultCell;

export type Notebook = {
  id: string;
  name: string;
  cells: Cell[];
  connectionId?: string | null;
  filePath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertNotebookInput = {
  id: string;
  name: string;
  cells: Cell[];
  connectionId?: string | null;
  filePath?: string | null;
};

export type ComposedSql = {
  sql: string;
  importedNames: string[];
};

export type NotebookError = {
  code: "storage_error" | "not_found" | "io_error" | "invalid_file" | "invalid_input";
  message: string;
};
