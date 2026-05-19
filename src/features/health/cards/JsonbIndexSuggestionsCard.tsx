/**
 * — JSONB Index Suggestions health card.
 *
 * Surfaces top-3 mined GIN-index suggestions from pg_stat_statements,
 * with a [View] button that opens SuggesterModal in column-scoped mode.
 *
 * Layout per spec §6.3.
 */

import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SuggesterModal } from "../../../features/jsonb/suggester/SuggesterModal";
import { classifyCardTone } from "../cardTone";
import type { CardState, JsonbIndexSuggestionRow } from "../store";
import { CardShell } from "./CardShell";

interface Props {
  connId: string;
  state: CardState;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

interface RowViewProps {
  row: JsonbIndexSuggestionRow;
  onView: (row: JsonbIndexSuggestionRow) => void;
}

function SuggestionRow({ row, onView }: RowViewProps): JSX.Element {
  const { t } = useTranslation();

  // Truncate the SQL for preview (show only beginning of CREATE INDEX …)
  const sqlPreview =
    row.recommendedSql.length > 70 ? `${row.recommendedSql.slice(0, 70)}…` : row.recommendedSql;

  return (    <li
      data-testid="jsonb-suggestion-row"
      style={{
        marginBottom: 10,
        paddingBottom: 10,
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500 }} data-testid="jsonb-row-label">
          {t("health.card.jsonb_index_suggestions.row", {
            schema: row.schema,
            table: row.table,
            column: row.column,
            op: row.op,
            calls: row.calls.toLocaleString(),
            time: formatMs(row.totalExecTimeMs),
          })}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          style={{ flexShrink: 0, fontSize: 11 }}
          data-testid="jsonb-row-view-btn"
          onClick={() => onView(row)}
          aria-label={`${t("health.card.jsonb_index_suggestions.viewAction")}: ${row.schema}.${row.table}.${row.column}`}
        >
          {t("health.card.jsonb_index_suggestions.viewAction")}
        </button>
      </div>
      <div
        style={{
          marginTop: 3,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          opacity: 0.7,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={row.recommendedSql}
        data-testid="jsonb-row-sql-preview"
      >
        → {sqlPreview}
      </div>
    </li>
);
}

export function JsonbIndexSuggestionsCard({ connId, state }: Props): JSX.Element {
  const { t } = useTranslation();
  const [viewFqn, setViewFqn] = useState<{
    schema: string;
    table: string;
    column: string;
  } | null>(null);

  if (state.status !== "ready" || state.card.id !== "jsonb_index_suggestions") {
    return <CardShell cardId="jsonb_index_suggestions" connId={connId} state={state} />;
  }

  const { rows } = state.card.data;
  const top3 = rows.slice(0, 3);

  // Derive tone from row count — warn if suggestions exist, ok otherwise.
  const tone = classifyCardTone("jsonb_index_suggestions", state) ?? "ok";
  const statusTooltipKey = tone === "warn" ? "health.status.warn" : "health.status.ok";

  const body =
    top3.length > 0 ? (      <ul
        style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12 }}
        data-testid="jsonb-suggestions-list"
      >
        {top3.map((row) => (          <SuggestionRow
            key={`${row.schema}.${row.table}.${row.column}`}
            row={row}
            onView={(r) => setViewFqn({ schema: r.schema, table: r.table, column: r.column })}
          />
))}
      </ul>
) : (      // S17-specific empty copy when pg_stat_statements IS available but no ops seen
      <div
        style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}
        data-testid="jsonb-suggestions-empty-body"
      >
        {t("health.card.jsonb_index_suggestions.empty")}
      </div>
);

  return (    <>
      <CardShell
        cardId="jsonb_index_suggestions"
        connId={connId}
        state={state}
        body={body}
        status={{ tone, tooltip: t(statusTooltipKey) }}
      />
      {viewFqn !== null ? (        <SuggesterModal
          open={viewFqn !== null}
          connId={connId}
          fqn={viewFqn}
          onClose={() => setViewFqn(null)}
        />
) : null}
    </>
);
}
