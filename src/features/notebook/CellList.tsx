/**
 * — ordered cell renderer.
 *
 * — production-grade UI. Replaces the scaffold:
 * - Splits cell rendering into `Cell` (router) + `SqlCell` /
 * `MarkdownCell` / `ResultCell`.
 * - Drag-and-drop reorder via HTML5 native events (no new dep).
 * - Add (SQL / Markdown), Delete, Duplicate, Move-up / -down per cell.
 * - Run-all / run-from cascades via the store's `runFrom`.
 *
 * Persistence is split: in-memory edits propagate to `onChange` (parent
 * pane drives autosave). Run-cell still writes through the store
 * directly so result snapshots survive a reload even before the autosave
 * timer fires.
 */
import { type DragEvent, type JSX, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Cell } from "./Cell";
import { useNotebooks } from "./store";
import type { Cell as CellT, MarkdownCell, Notebook, SqlCell } from "./types";

interface CellListProps {
  notebook: Notebook;
  onChange: (next: Notebook) => void;
  connectionId: string | null;
}

const newId = (): string =>
  `c-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

export function CellList({ notebook, onChange, connectionId }: CellListProps): JSX.Element {
  const { t } = useTranslation();
  const runFrom = useNotebooks((s) => s.runFrom);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const update = useCallback(
    (next: Notebook) => {
      onChange(next);
    },
    [onChange],
  );

  const addCell = (kind: "sql" | "markdown") => {
    const cell: CellT =
      kind === "sql"
        ? ({
            kind: "sql",
            id: newId(),
            source: "",
            shareAsCte: false,
          } satisfies SqlCell)
        : ({ kind: "markdown", id: newId(), source: "" } satisfies MarkdownCell);
    update({ ...notebook, cells: [...notebook.cells, cell] });
  };

  const updateCell = (idx: number, next: CellT) => {
    const cells = notebook.cells.slice();
    cells[idx] = next;
    update({ ...notebook, cells });
  };

  const deleteCell = (id: string) => {
    update({ ...notebook, cells: notebook.cells.filter((c) => c.id !== id) });
  };

  const duplicateCell = (id: string) => {
    const idx = notebook.cells.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const src = notebook.cells[idx];
    if (!src) return;
    // Strip results when duplicating SQL — pasted cells start fresh.
    const dup: CellT =
      src.kind === "sql" ? { ...src, id: newId(), result: undefined } : { ...src, id: newId() };
    const cells = notebook.cells.slice();
    cells.splice(idx + 1, 0, dup);
    update({ ...notebook, cells });
  };

  const moveCell = (id: string, delta: -1 | 1) => {
    const idx = notebook.cells.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= notebook.cells.length) return;
    const cells = notebook.cells.slice();
    const [moved] = cells.splice(idx, 1);
    if (!moved) return;
    cells.splice(target, 0, moved);
    update({ ...notebook, cells });
  };

  const runAll = () => {
    if (!connectionId) return;
    void runFrom(notebook.id, null, connectionId);
  };

  const runFromCell = (id: string) => {
    if (!connectionId) return;
    void runFrom(notebook.id, id, connectionId);
  };

  // ─── Drag & drop ────────────────────────────────────────────────────
  const onDragStart = (id: string) => (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/x-notebook-cell", id);
    setDraggingId(id);
  };

  const onDragOver = (id: string) => (e: DragEvent<HTMLElement>) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetId !== id) setDropTargetId(id);
  };

  const onDrop = (id: string) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/x-notebook-cell") || draggingId;
    if (!sourceId || sourceId === id) {
      setDraggingId(null);
      setDropTargetId(null);
      return;
    }
    const fromIdx = notebook.cells.findIndex((c) => c.id === sourceId);
    const toIdx = notebook.cells.findIndex((c) => c.id === id);
    if (fromIdx < 0 || toIdx < 0) return;
    const cells = notebook.cells.slice();
    const [moved] = cells.splice(fromIdx, 1);
    if (!moved) return;
    cells.splice(toIdx, 0, moved);
    update({ ...notebook, cells });
    setDraggingId(null);
    setDropTargetId(null);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  return (
    <div
      data-testid="notebook-cell-list"
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 16px 24px" }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          data-testid="notebook-add-sql"
          onClick={() => addCell("sql")}
          className="btn"
        >
          {t("notebook.action.add_sql")}
        </button>
        <button
          type="button"
          data-testid="notebook-add-markdown"
          onClick={() => addCell("markdown")}
          className="btn btn-ghost"
        >
          {t("notebook.action.add_markdown")}
        </button>
        <button
          type="button"
          data-testid="notebook-run-all"
          onClick={runAll}
          disabled={!connectionId || notebook.cells.every((c) => c.kind !== "sql")}
          className="btn btn-ghost"
        >
          {t("notebook.action.run_all")}
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted, #888)" }}>
          {t("notebook.cell_count", { count: notebook.cells.length })}
        </span>
      </div>

      {notebook.cells.length === 0 ? (
        <div
          data-testid="notebook-empty"
          style={{ padding: 24, textAlign: "center", color: "var(--muted, #888)" }}
        >
          {t("notebook.empty")}
        </div>
      ) : null}

      {notebook.cells.map((cell, idx) => (
        <Cell
          key={cell.id}
          cell={cell}
          index={idx}
          notebook={notebook}
          connectionId={connectionId}
          onChange={(next) => updateCell(idx, next)}
          onDelete={() => deleteCell(cell.id)}
          onDuplicate={() => duplicateCell(cell.id)}
          onMove={(delta) => moveCell(cell.id, delta)}
          onRunFromHere={() => runFromCell(cell.id)}
          isDropTarget={dropTargetId === cell.id}
          isFirst={idx === 0}
          isLast={idx === notebook.cells.length - 1}
          onDragStart={onDragStart(cell.id)}
          onDragOver={onDragOver(cell.id)}
          onDrop={onDrop(cell.id)}
          onDragEnd={onDragEnd}
        />
      ))}

      {connectionId === null ? (
        <span style={{ color: "var(--muted, #888)", fontSize: 12 }}>
          {t("notebook.no_connection_hint")}
        </span>
      ) : null}
    </div>
  );
}
