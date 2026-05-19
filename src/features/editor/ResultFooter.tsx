import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RunState } from "./store";

type Streaming = Extract<RunState, { status: "streaming" }>;

/**
 * Compact chip footer (Q7 in spec):
 * - loading / prefetching / done / affected — picked by streaming state
 * - sort indicator on the right when sort != null
 * - duration always shown
 *
 * `aria-live="polite"` so screen readers announce row-count changes.
 */
export function ResultFooter({ run }: { run: Streaming }): JSX.Element {
  const { t } = useTranslation();
  const isSelectResult = run.statusMessage.startsWith("SELECT");
  // Footer-text decision tree:
  // - affectedRows non-null  → DML/DDL was executed (fix routes
  // SELECT-with-empty-columns through the row-returning path so this
  // branch is reserved for true `INSERT/UPDATE/DELETE`).
  // - exhausted SELECT with 0 columns → unusual `SELECT FROM tbl` shape;
  // surface column count so the empty grid header isn't confusing.
  // - exhausted otherwise → row count.
  // - prefetching → background fetch is running.
  // - cursor open + idle → 's "paused, scroll for next page".
  // - anything else → opening / first-page in flight.
  const rowsKey = (() => {
    if (run.affectedRows !== null) return "editor.result.rows_affected";
    if (run.exhausted && isSelectResult && run.columns.length === 0) {
      return "editor.result.rows_returned";
    }
    if (run.exhausted) return "editor.result.rows_done";
    if (run.prefetching) return "editor.result.rows_prefetching";
    if (run.cursorId !== null) return "editor.result.rows_paused";
    return "editor.result.rows_loading";
  })();
  const rowsLabel = t(rowsKey, {
    n: run.affectedRows ?? run.loadedCount,
    cols: run.columns.length,
  });

  const sortLabel = run.sort
    ? t("editor.result.sort_subset", {
        col: run.columns[run.sort.columnIdx]?.name ?? "?",
        dir: run.sort.dir,
      })
    : null;

  return (    <div
      aria-live="polite"
      style={{
        height: 26,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderTop: "1px solid var(--hairline)",
        padding: "0 14px",
        fontFamily: "var(--font-sans-q)",
        fontSize: 11,
        color: "var(--ink-4)",
      }}
      data-testid="result-footer"
    >
      <span>{rowsLabel}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {sortLabel ? <span data-testid="result-footer-sort">{sortLabel}</span> : null}
        <span style={{ fontFamily: "var(--font-mono-q)" }}>
          {t("editor.result.duration", { ms: run.durationMs })}
        </span>
      </span>
    </div>
);
}
