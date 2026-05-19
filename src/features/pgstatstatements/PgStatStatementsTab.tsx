// — owner: .
//
// `PgStatStatementsTab` is a singleton-per-connection tab body that runs
// a parameterised SELECT against `pg_stat_statements`, renders the result
// in a sortable HTML table, and exposes Reset / Export CSV / Refresh
// affordances.
//
// State lives in component-local `useState` (no zustand sub-store) because
// the tab is transient — its lifecycle matches the tab itself. On mount
// and on every change to topN / sortBy / sortDir we re-query via
// `queryExecute`. A small Radix Dialog confirms the destructive
// `pg_stat_statements_reset()` call.
import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useCallback, useEffect, useState } from "react";

import { queryExecute } from "../../lib/tauri";
import type { PgStatStatementsTab as TabModel } from "../editor/store";
import { rowsToCsv } from "./csvExport";
import { type StatementsSortColumn, buildStatementsQuery } from "./statementsQuery";

export interface PgStatStatementsTabProps {
  tab: TabModel;
}

const TOP_N_OPTIONS = [50, 100, 500, 1000, 5000] as const;

const SORT_OPTIONS: { value: StatementsSortColumn; label: string }[] = [
  { value: "total_exec_time", label: "Total exec time" },
  { value: "mean_exec_time", label: "Mean exec time" },
  { value: "calls", label: "Calls" },
  { value: "rows", label: "Rows" },
  { value: "shared_blks_hit", label: "Shared blocks hit" },
];

const COLUMN_ORDER = [
  "query",
  "calls",
  "total_exec_time",
  "mean_exec_time",
  "rows",
  "shared_blks_hit",
] as const;

const SORTABLE_COLUMNS: ReadonlySet<StatementsSortColumn> = new Set([
  "calls",
  "total_exec_time",
  "mean_exec_time",
  "rows",
  "shared_blks_hit",
]);

type Result = {
  columns: { name: string; typeName: string; isNumeric: boolean }[];
  rows: (string | null)[][];
};

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; result: Result }
  | { kind: "error"; message: string };

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function formatMs(value: string | null): string {
  if (value === null) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return `${n.toFixed(2)} ms`;
}

export function PgStatStatementsTab(props: PgStatStatementsTabProps): JSX.Element {
  const { tab } = props;
  const connId = tab.connectionId;

  const [topN, setTopN] = useState<number>(50);
  const [sortBy, setSortBy] = useState<StatementsSortColumn>("total_exec_time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [resetOpen, setResetOpen] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    setStatus({ kind: "loading" });
    try {
      const sql = buildStatementsQuery({ topN, sortBy, sortDir });
      const result = await queryExecute(connId, sql);
      setStatus({
        kind: "ok",
        result: { columns: result.columns, rows: result.rows },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "error", message });
    }
  }, [connId, topN, sortBy, sortDir]);

  // Re-query on mount + whenever the controls change. The deps cover all
  // inputs to `buildStatementsQuery`; refresh itself is memoised against
  // them via useCallback.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSortHeader = (col: StatementsSortColumn): void => {
    if (col === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const handleConfirmReset = useCallback(async (): Promise<void> => {
    try {
      await queryExecute(connId, "SELECT pg_stat_statements_reset();");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "error", message });
      setResetOpen(false);
      return;
    }
    setResetOpen(false);
    await refresh();
  }, [connId, refresh]);

  const handleExportCsv = (): void => {
    if (status.kind !== "ok") return;
    const csv = rowsToCsv([...COLUMN_ORDER], status.result.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pg_stat_statements_${connId}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const headerCellStyle: React.CSSProperties = {
    textAlign: "left",
    padding: "4px 8px",
    borderBottom: "1px solid var(--hairline)",
    fontWeight: 600,
    fontSize: 11,
    cursor: "pointer",
    userSelect: "none",
  };
  const cellStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderBottom: "1px solid var(--hairline)",
    fontSize: 12,
    verticalAlign: "top",
  };
  const numericCellStyle: React.CSSProperties = {
    ...cellStyle,
    fontFamily: "var(--mono, monospace)",
    textAlign: "right",
  };

  return (    <div
      data-testid="pg-stat-statements-tab"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 8,
        height: "100%",
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: 4,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="pgss-refresh"
          onClick={() => {
            void refresh();
          }}
          disabled={status.kind === "loading"}
        >
          Refresh
        </button>

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <span>Top-N:</span>
          <select
            data-testid="pgss-top-n"
            value={String(topN)}
            onChange={(e) => setTopN(Number.parseInt(e.target.value, 10))}
          >
            {TOP_N_OPTIONS.map((n) => (              <option key={n} value={String(n)}>
                {n}
              </option>
))}
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <span>Sort by:</span>
          <select
            data-testid="pgss-sort-by"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as StatementsSortColumn)}
          >
            {SORT_OPTIONS.map((opt) => (              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
))}
          </select>
        </label>

        <select
          data-testid="pgss-sort-dir"
          value={sortDir}
          onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
        >
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          className="btn btn-danger"
          data-testid="pgss-reset"
          onClick={() => setResetOpen(true)}
        >
          Reset Stats…
        </button>

        <button
          type="button"
          className="btn btn-ghost"
          data-testid="pgss-export-csv"
          onClick={handleExportCsv}
          disabled={status.kind !== "ok" || status.result.rows.length === 0}
        >
          Export CSV
        </button>
      </div>

      {status.kind === "loading" ? (        <div style={{ padding: 8, fontSize: 12, color: "var(--ink-3)" }}>Loading…</div>
) : null}

      {status.kind === "error" ? (        <div
          data-testid="pgss-error"
          role="alert"
          style={{ padding: 8, fontSize: 12, color: "var(--danger, #c0392b)" }}
        >
          {status.message}
        </div>
) : null}

      {status.kind === "ok" ? (        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <thead>
            <tr>
              {COLUMN_ORDER.map((col) => {
                const sortable = SORTABLE_COLUMNS.has(col as StatementsSortColumn);
                const isActive = sortable && col === sortBy;
                const indicator = isActive ? (sortDir === "asc" ? " ↑" : " ↓") : "";
                return (                  <th
                    key={col}
                    style={{
                      ...headerCellStyle,
                      textAlign: col === "query" ? "left" : "right",
                      cursor: sortable ? "pointer" : "default",
                    }}
                    onClick={() => {
                      if (sortable) handleSortHeader(col as StatementsSortColumn);
                    }}
                    data-testid={`pgss-th-${col}`}
                  >
                    {col}
                    {indicator}
                  </th>
);
              })}
            </tr>
          </thead>
          <tbody>
            {status.result.rows.map((row, rIdx) => (              <tr key={rIdx}>
                {COLUMN_ORDER.map((col, cIdx) => {
                  const value = row[cIdx] ?? null;
                  if (col === "query") {
                    const text = value ?? "";
                    return (                      <td key={col} style={cellStyle}>
                        <details>
                          <summary
                            style={{
                              cursor: "pointer",
                              fontFamily: "var(--mono, monospace)",
                              fontSize: 11,
                            }}
                          >
                            {truncate(text, 80)}
                          </summary>
                          <pre
                            style={{
                              whiteSpace: "pre-wrap",
                              fontFamily: "var(--mono, monospace)",
                              fontSize: 11,
                              margin: "4px 0 0 0",
                            }}
                          >
                            {text}
                          </pre>
                        </details>
                      </td>
);
                  }
                  if (col === "total_exec_time" || col === "mean_exec_time") {
                    return (                      <td key={col} style={numericCellStyle}>
                        {formatMs(value)}
                      </td>
);
                  }
                  return (                    <td key={col} style={numericCellStyle}>
                      {value ?? ""}
                    </td>
);
                })}
              </tr>
))}
            {status.result.rows.length === 0 ? (              <tr>
                <td
                  colSpan={COLUMN_ORDER.length}
                  style={{ ...cellStyle, color: "var(--ink-3)", textAlign: "center" }}
                >
                  No statements recorded.
                </td>
              </tr>
) : null}
          </tbody>
        </table>
) : null}

      <RadixDialog.Root
        open={resetOpen}
        onOpenChange={(o) => {
          if (!o) setResetOpen(false);
        }}
      >
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="q-backdrop" />
          <RadixDialog.Content
            className="q-modal sm"
            data-testid="pgss-reset-dialog"
            style={{
              padding: 20,
              minWidth: 360,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <RadixDialog.Title className="q-modal-title">
              Reset pg_stat_statements?
            </RadixDialog.Title>
            <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
              This will reset all pg_stat_statements counters. Continue?
            </RadixDialog.Description>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="pgss-reset-cancel"
                onClick={() => setResetOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="pgss-reset-confirm"
                onClick={() => {
                  void handleConfirmReset();
                }}
              >
                Reset Stats
              </button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </div>
);
}
