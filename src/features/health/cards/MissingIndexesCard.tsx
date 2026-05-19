import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";

interface CardProps {
  connId: string;
  state: CardState;
}

export function MissingIndexesCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "missing_indexes") {
    return <CardShell cardId="missing_indexes" connId={connId} state={state} />;
  }

  const rows = state.card.data.rows;
  if (rows.length === 0) {
    return (      <CardShell
        cardId="missing_indexes"
        connId={connId}
        state={{ status: "empty", reason: "no_data" }}
      />
);
  }

  const top3 = rows.slice(0, 3);
  const tone = "warn" as const;

  const body = (    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12 }}>
      {top3.map((r) => (        <li
          key={`${r.schema}.${r.table}`}
          data-testid="missing-index-row"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {t("health.card.missing_indexes.row", {
            schema: r.schema,
            table: r.table,
            seq: r.seqScan,
            idx: r.indexScan,
          })}
        </li>
))}
    </ul>
);

  return (    <CardShell
      cardId="missing_indexes"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
);
}
