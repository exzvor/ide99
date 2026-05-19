/**
 * — Result snapshot renderer.
 *
 * Compact table: 10 rows visible by default; «Show all» expander reveals
 * the rest. We intentionally don't pull in a virtualised grid — notebook
 * results are a snapshot of a (typically small) result, not a streaming
 * grid. ResultGrid is reserved for the editor tab.
 */
import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CellResult } from "./types";

interface Props {
  result: CellResult;
  cellId: string;
}

const DEFAULT_VISIBLE = 10;

export function ResultCell({ result, cellId }: Props): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<boolean>(false);

  const visible = expanded ? result.rows : result.rows.slice(0, DEFAULT_VISIBLE);
  const hasMore = result.rows.length > DEFAULT_VISIBLE;

  return (    <div
      data-testid={`result-cell-${cellId}`}
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "6px 10px",
          fontSize: 11,
          color: "var(--muted, #888)",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <span data-testid={`result-cell-${cellId}-rowcount`}>
          {t("notebook.result.row_count", { count: result.rows.length })}
        </span>
        <span>{t("notebook.result.duration", { ms: result.durationMs })}</span>
        {result.truncated ? (          <span style={{ color: "var(--warn, #d49b1c)" }}>{t("notebook.result.truncated")}</span>
) : null}
      </div>
      {result.rows.length === 0 ? (        <div style={{ padding: 12, fontSize: 12, color: "var(--muted, #888)" }}>
          {t("notebook.result.empty")}
        </div>
) : (        <div style={{ overflowX: "auto" }}>
          <table
            data-testid={`result-cell-${cellId}-table`}
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
            }}
          >
            <thead>
              <tr>
                {result.columns.map((c) => (                  <th
                    key={c}
                    style={{
                      textAlign: "left",
                      padding: "4px 8px",
                      borderBottom: "1px solid var(--hairline)",
                      background: "var(--bg-elev)",
                      fontWeight: 600,
                    }}
                  >
                    {c}
                  </th>
))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, ri) => (                // biome-ignore lint/suspicious/noArrayIndexKey: snapshot rows have no stable id
                <tr key={ri}>
                  {row.map((v, ci) => (                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: snapshot rows have no stable id
                      key={ci}
                      style={{
                        padding: "4px 8px",
                        borderBottom: "1px solid var(--hairline)",
                        whiteSpace: "nowrap",
                        maxWidth: 320,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {v === null ? <span style={{ color: "var(--muted, #888)" }}>NULL</span> : v}
                    </td>
))}
                </tr>
))}
            </tbody>
          </table>
        </div>
)}
      {hasMore ? (        <div style={{ padding: 8, textAlign: "center", borderTop: "1px solid var(--hairline)" }}>
          <button
            type="button"
            data-testid={`result-cell-${cellId}-toggle`}
            onClick={() => setExpanded((v) => !v)}
            className="btn btn-ghost"
          >
            {expanded
              ? t("notebook.result.show_less")
              : t("notebook.result.show_all", { count: result.rows.length })}
          </button>
        </div>
) : null}
    </div>
);
}
