import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../actions/ActionButton";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";
import { prettyBytes } from "./DbSizeCard";

interface CardProps {
  connId: string;
  state: CardState;
}

function bloatTone(maxPct: number): "ok" | "warn" | "danger" {
  if (maxPct > 30) return "danger";
  if (maxPct > 15) return "warn";
  return "ok";
}

export function BloatCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "bloat") {
    return <CardShell cardId="bloat" connId={connId} state={state} />;
  }

  const rows = state.card.data.rows;
  if (rows.length === 0) {
    return (
      <CardShell cardId="bloat" connId={connId} state={{ status: "empty", reason: "no_data" }} />
    );
  }

  const top3 = rows.slice(0, 3);
  const more = rows.length - top3.length;
  const maxPct = rows.reduce((acc, r) => Math.max(acc, r.bloatPct), 0);
  const tone = bloatTone(maxPct);

  const body = (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12 }}>
      {top3.map((r) => (
        <li
          key={`${r.schema}.${r.table}`}
          data-testid="bloat-row"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {t("health.card.bloat.row", {
            schema: r.schema,
            table: r.table,
            pct: `${r.bloatPct.toFixed(0)}%`,
            size: prettyBytes(r.bloatBytes),
          })}
          <span className="row-actions" data-testid="bloat-row-actions">
            <ActionButton
              kind="vacuum"
              target={{
                kind: "vacuum",
                schema: r.schema,
                table: r.table,
                sizeBytes: r.bloatBytes,
              }}
              connId={connId}
            />
            <ActionButton
              kind="reindexTable"
              target={{
                kind: "reindexTable",
                schema: r.schema,
                table: r.table,
                sizeBytes: r.bloatBytes,
              }}
              connId={connId}
            />
          </span>
        </li>
      ))}
      {more > 0 ? (
        <li style={{ opacity: 0.65 }} data-testid="bloat-more">
          {t("health.card.bloat.more", { count: more })}
        </li>
      ) : null}
    </ul>
  );

  return (
    <CardShell
      cardId="bloat"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
  );
}
