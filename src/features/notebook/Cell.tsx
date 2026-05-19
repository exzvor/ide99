/**
 * — Cell router. Each cell is self-contained: it owns its
 * toolbar (move, duplicate, delete, drag-handle) and dispatches to the
 * type-specific component. Drag-and-drop is HTML5 native — `draggable`
 * on the article + `dataTransfer` carrying the source cell id.
 *
 * The toolbar deliberately includes redundant move-up/move-down buttons
 * so keyboard users have a non-DnD path (.
 */
import type { DragEvent, JSX, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownCell } from "./MarkdownCell";
import { ResultCell } from "./ResultCell";
import { SqlCell } from "./SqlCell";
import type { Cell as CellT, Notebook } from "./types";

export interface CellProps {
  cell: CellT;
  index: number;
  notebook: Notebook;
  connectionId: string | null;
  onChange: (next: CellT) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (delta: -1 | 1) => void;
  onRunFromHere: () => void;
  /** True when the cell is the drop target for a current drag. Used to
   * paint a horizontal rule highlight. */
  isDropTarget: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** HTML5 native drag handlers — wired here so the article gets a clean
   * `draggable={true}` declaration without the parent leaking refs. */
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: (e: DragEvent<HTMLElement>) => void;
}

export function Cell(props: CellProps): JSX.Element {
  const { t } = useTranslation();
  const {
    cell,
    index,
    notebook,
    connectionId,
    onChange,
    onDelete,
    onDuplicate,
    onMove,
    onRunFromHere,
    isDropTarget,
    isFirst,
    isLast,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
  } = props;

  const onKeyDownToolbar = (e: KeyboardEvent<HTMLElement>) => {
    // Cmd/Ctrl-D inside cell toolbar duplicates; Esc returns focus.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      onDuplicate();
    }
  };

  return (
    <article
      data-testid={`cell-${cell.id}`}
      data-cell-kind={cell.kind}
      data-cell-index={index}
      draggable={true}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDownToolbar}
      style={{
        border: isDropTarget ? "1px dashed var(--accent, #4a90e2)" : "1px solid var(--hairline)",
        borderRadius: 6,
        padding: 12,
        background: "var(--bg-elev)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          fontSize: 11,
          color: "var(--muted, #888)",
        }}
      >
        <span
          data-testid={`cell-${cell.id}-drag-handle`}
          aria-label={t("notebook.action.drag")}
          title={t("notebook.action.drag")}
          role="img"
          style={{ cursor: "grab", userSelect: "none", padding: "0 4px", fontSize: 14 }}
        >
          ⋮⋮
        </span>
        <span data-testid={`cell-${cell.id}-kind`}>
          {t(`notebook.cell_kind.${cell.kind}`)} #{index + 1}
        </span>
        <button
          type="button"
          data-testid={`cell-${cell.id}-up`}
          onClick={() => onMove(-1)}
          disabled={isFirst}
          aria-label={t("notebook.action.move_up")}
          className="btn btn-ghost"
        >
          ↑
        </button>
        <button
          type="button"
          data-testid={`cell-${cell.id}-down`}
          onClick={() => onMove(1)}
          disabled={isLast}
          aria-label={t("notebook.action.move_down")}
          className="btn btn-ghost"
        >
          ↓
        </button>
        <button
          type="button"
          data-testid={`cell-${cell.id}-duplicate`}
          onClick={onDuplicate}
          aria-label={t("notebook.action.duplicate")}
          className="btn btn-ghost"
        >
          {t("notebook.action.duplicate")}
        </button>
        {cell.kind === "sql" ? (
          <button
            type="button"
            data-testid={`cell-${cell.id}-run-from`}
            onClick={onRunFromHere}
            aria-label={t("notebook.action.run_from")}
            className="btn btn-ghost"
          >
            {t("notebook.action.run_from")}
          </button>
        ) : null}
        <button
          type="button"
          data-testid={`cell-${cell.id}-delete`}
          onClick={onDelete}
          aria-label={t("notebook.action.delete")}
          className="btn btn-ghost"
          style={{ marginLeft: "auto" }}
        >
          {t("notebook.action.delete")}
        </button>
      </header>

      {cell.kind === "sql" ? (
        <SqlCell
          cell={cell}
          index={index}
          notebook={notebook}
          connectionId={connectionId}
          onChange={(next) => onChange(next)}
        />
      ) : cell.kind === "markdown" ? (
        <MarkdownCell
          cell={cell}
          notebookCells={notebook.cells}
          onChange={(next) => onChange(next)}
        />
      ) : (
        <ResultCell result={cell.result} cellId={cell.id} />
      )}
    </article>
  );
}
