// Notebook feature surface.
//
// Notebook = Jupyter-style multi-cell SQL workbook. Tab kind `notebook`
// renders `NotebookPane` (this folder). Backend lives in
// `src-tauri/src/notebook/`.

export { Cell } from "./Cell";
export { CellList } from "./CellList";
export { MarkdownCell } from "./MarkdownCell";
export { NotebookPane } from "./NotebookPane";
export { NotebookSqlEditor } from "./NotebookSqlEditor";
export { ResultCell } from "./ResultCell";
export { SqlCell } from "./SqlCell";
export { useAutosave } from "./useAutosave";
export type { AutosaveResult, AutosaveStatus } from "./useAutosave";
export { parseVariableRef, renderMarkdown, substituteVariables } from "./markdownVars";
export type { VariableRef } from "./markdownVars";
export { useNotebooks } from "./store";
export type { CellRunState } from "./store";
export type {
  Cell as NotebookCell,
  CellResult,
  ComposedSql,
  Notebook,
  NotebookError,
  SqlCell as NotebookSqlCellT,
  MarkdownCell as NotebookMarkdownCellT,
  ResultCell as NotebookResultCellT,
  UpsertNotebookInput,
} from "./types";
