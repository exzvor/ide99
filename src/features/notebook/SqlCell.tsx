/**
 * — SQL cell.
 *
 * Edits a single `SqlCell`, exposes:
 * - Run button (delegates to store.runCell)
 * - "Run from here" (downstream cells in order)
 * - "Share as CTE" toggle + cte name
 * - Status pill (idle / running / ok / error) + duration
 *
 * Monaco mounts via `NotebookSqlEditor` (thin wrapper that doesn't depend
 * on the editor-tab store). We deliberately do NOT touch
 * `setActiveMonacoEditor` — notebook cells aren't part of the snippet
 * palette target rotation, and tying them in would require teasing apart
 * the global "active editor" state across tab kinds.
 */
import { type JSX, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { NotebookSqlEditor } from "./NotebookSqlEditor";
import { ResultCell } from "./ResultCell";
import { type CellRunState, useNotebooks } from "./store";
import type { Notebook, SqlCell as SqlCellT } from "./types";

const IDLE_RUN_STATE: CellRunState = { status: "idle" };

interface Props {
  cell: SqlCellT;
  index: number;
  notebook: Notebook;
  connectionId: string | null;
  onChange: (next: SqlCellT) => void;
}

export function SqlCell({ cell, index, notebook, connectionId, onChange }: Props): JSX.Element {
  const { t } = useTranslation();
  const runCell = useNotebooks((s) => s.runCell);
  const runFrom = useNotebooks((s) => s.runFrom);
  const runStateRaw = useNotebooks((s) => s.runStateByCellId[cell.id]);
  const runState: CellRunState = runStateRaw ?? IDLE_RUN_STATE;

  const cteName = cell.cteName ?? `cell_${index}`;

  const handleRun = useCallback(() => {
    if (!connectionId) return;
    void runCell(notebook.id, cell.id, connectionId);
  }, [runCell, notebook.id, cell.id, connectionId]);

  const handleRunFromHere = useCallback(() => {
    if (!connectionId) return;
    void runFrom(notebook.id, cell.id, connectionId);
  }, [runFrom, notebook.id, cell.id, connectionId]);

  const statusPill = useMemo(() => {
    switch (runState.status) {
      case "running":
        return { label: t("notebook.status.running"), tone: "var(--ink-3, #888)" };
      case "ok":
        return {
          label: t("notebook.status.ok", { ms: runState.durationMs }),
          tone: "var(--ok, #2a8)",
        };
      case "error":
        return { label: t("notebook.status.error"), tone: "var(--err, #d33)" };
      default:
        return { label: t("notebook.status.idle"), tone: "var(--muted, #888)" };
    }
  }, [runState, t]);

  const noConn = connectionId === null;

  return (
    <div
      data-testid={`sql-cell-${cell.id}`}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          data-testid={`sql-cell-${cell.id}-run`}
          onClick={handleRun}
          disabled={noConn || runState.status === "running"}
          aria-label={t("notebook.action.run_cell")}
          className="btn"
          title={t("notebook.action.run_cell")}
        >
          {t("notebook.action.run_cell_icon")}
        </button>
        <button
          type="button"
          data-testid={`sql-cell-${cell.id}-run-from`}
          onClick={handleRunFromHere}
          disabled={noConn || runState.status === "running"}
          className="btn btn-ghost"
          aria-label={t("notebook.action.run_from")}
        >
          {t("notebook.action.run_from")}
        </button>
        <span
          data-testid={`sql-cell-${cell.id}-status`}
          style={{ fontSize: 12, color: statusPill.tone }}
        >
          {statusPill.label}
        </span>
        <label
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
          title={t("notebook.cte.help")}
        >
          <input
            type="checkbox"
            data-testid={`sql-cell-${cell.id}-cte-toggle`}
            checked={cell.shareAsCte === true}
            onChange={(e) =>
              onChange({
                ...cell,
                shareAsCte: e.target.checked,
                cteName: e.target.checked ? cteName : cell.cteName,
              })
            }
          />
          <span>{t("notebook.cte.share_label")}</span>
        </label>
        {cell.shareAsCte ? (
          <input
            type="text"
            data-testid={`sql-cell-${cell.id}-cte-name`}
            aria-label={t("notebook.cte.name_label")}
            value={cteName}
            onChange={(e) => onChange({ ...cell, cteName: e.target.value })}
            style={{
              fontSize: 12,
              fontFamily: "var(--font-mono, monospace)",
              padding: "2px 6px",
              border: "1px solid var(--hairline)",
              background: "var(--bg)",
              color: "var(--fg)",
              minWidth: 100,
            }}
          />
        ) : null}
      </div>
      <NotebookSqlEditor
        cellId={cell.id}
        value={cell.source}
        onChange={(source) => onChange({ ...cell, source })}
        onRun={handleRun}
      />
      {runState.status === "error" ? (
        <div
          data-testid={`sql-cell-${cell.id}-error`}
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--err, #d33)",
            border: "1px solid var(--err, #d33)",
            background: "color-mix(in srgb, var(--err, #d33) 8%, transparent)",
            padding: "6px 8px",
            borderRadius: 4,
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          {runState.message}
        </div>
      ) : null}
      {cell.result ? <ResultCell result={cell.result} cellId={cell.id} /> : null}
    </div>
  );
}
