import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ReproduceOnDisposableButton } from "../../paid-modules";
import { ActionButton } from "../actions/ActionButton";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";

interface CardProps {
  connId: string;
  state: CardState;
}

function slowTone(maxMean: number): "ok" | "warn" | "danger" {
  if (maxMean > 1000) return "danger";
  if (maxMean > 100) return "warn";
  return "ok";
}

function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function SlowQueriesCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "slow_queries") {
    return <CardShell cardId="slow_queries" connId={connId} state={state} />;
  }

  const rows = state.card.data.rows;
  const top3 = rows.slice(0, 3);
  const maxMean = rows.reduce((acc, r) => Math.max(acc, r.meanTimeMs), 0);
  const tone = slowTone(maxMean);

  const body = (    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12 }}>
      {top3.map((r) => (        <li key={`${r.query}:${r.calls}`} data-testid="slow-row" style={{ marginBottom: 4 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={r.query}
          >
            {truncate(r.query, 80)}
          </div>
          <div style={{ fontSize: 11, opacity: 0.75 }}>
            {t("health.card.slow_queries.row", {
              mean: r.meanTimeMs.toFixed(1),
              calls: r.calls,
            })}
          </div>
          <span className="row-actions" data-testid="slow-queries-row-actions">
            <ActionButton
              kind="explain"
              target={{ kind: "explain", sql: r.query }}
              connId={connId}
            />
            {/* — SPG99 paid-module slot. Visible without
                subscription (routes to upgrade page on click); functional
                with subscription (opens template picker pre-filled with
                the project schema preset). */}
            <ReproduceOnDisposableButton query={r.query} />
          </span>
        </li>
))}
    </ul>
);

  return (    <CardShell
      cardId="slow_queries"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
);
}
