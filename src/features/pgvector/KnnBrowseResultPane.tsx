// — owner: .
// Lightweight result pane for kNN browse: runs the SQL produced by
// KnnBrowseDialog, shows a small HTML <table>, and right-aligns the trailing
// `distance` column with a monospace font. Intentionally simpler than
// `ResultGrid` — kNN results are always small (LIMIT-bounded) so we don't need
// virtualization here. Errors are surfaced inline.
import { type JSX, useEffect, useState } from "react";
import { type QueryResult, queryExecute } from "../../lib/tauri";

export interface KnnBrowseResultPaneProps {
  connId: string;
  sql: string;
  onClose: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "ok"; result: QueryResult }
  | { kind: "err"; message: string };

export function KnnBrowseResultPane(props: KnnBrowseResultPaneProps): JSX.Element {
  const { connId, sql, onClose } = props;
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    queryExecute(connId, sql)
      .then((result) => {
        if (!cancelled) setState({ kind: "ok", result });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "err", message });
      });
    return () => {
      cancelled = true;
    };
  }, [connId, sql]);

  return (    <div data-testid="knn-result-pane" style={{ padding: 12 }}>
      {state.kind === "loading" && (        <div data-testid="knn-result-loading">
          <span className="q-spinner" /> Running…
        </div>
)}
      {state.kind === "err" && (        <div
          data-testid="knn-result-error"
          style={{
            color: "var(--danger)",
            background: "var(--danger-bg, #fee)",
            padding: 8,
            fontSize: 12.5,
          }}
        >
          {state.message}
        </div>
)}
      {state.kind === "ok" && <ResultTable result={state.result} />}
      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
);
}

function ResultTable({ result }: { result: QueryResult }): JSX.Element {
  const lastIdx = result.columns.length - 1;
  return (    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
      <thead>
        <tr>
          {result.columns.map((c, i) => (            <th
              key={c.name}
              style={{
                textAlign: i === lastIdx ? "right" : "left",
                fontFamily: i === lastIdx ? "monospace" : undefined,
                borderBottom: "1px solid var(--ink-5, #ccc)",
                padding: "4px 8px",
              }}
            >
              {c.name}
            </th>
))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, ri) => (          // biome-ignore lint/suspicious/noArrayIndexKey: rows are ephemeral & non-reordered
          <tr key={ri}>
            {row.map((cell, ci) => (              <td
                // biome-ignore lint/suspicious/noArrayIndexKey: row cells map 1:1 to columns
                key={ci}
                style={{
                  textAlign: ci === lastIdx ? "right" : "left",
                  fontFamily: ci === lastIdx ? "monospace" : undefined,
                  padding: "4px 8px",
                  borderBottom: "1px solid var(--ink-6, #eee)",
                }}
              >
                {cell ?? <span style={{ color: "var(--ink-3)" }}>NULL</span>}
              </td>
))}
          </tr>
))}
      </tbody>
    </table>
);
}
