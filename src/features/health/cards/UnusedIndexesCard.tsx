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

const ONE_HUNDRED_MB = 100 * 1024 * 1024;

export function UnusedIndexesCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "unused_indexes") {
    return <CardShell cardId="unused_indexes" connId={connId} state={state} />;
  }

  const rows = state.card.data.rows;
  if (rows.length === 0) {
    return (      <CardShell
        cardId="unused_indexes"
        connId={connId}
        state={{ status: "empty", reason: "no_data" }}
      />
);
  }

  const top3 = rows.slice(0, 3);
  const total = rows.reduce((acc, r) => acc + r.sizeBytes, 0);
  const tone: "ok" | "warn" = total > ONE_HUNDRED_MB ? "warn" : "ok";

  const body = (    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <tbody>
        {top3.map((r) => (          <tr key={`${r.schema}.${r.index}`} data-testid="unused-index-row">
            <td style={{ padding: "2px 4px", fontFamily: "var(--font-mono)" }}>
              {t("health.card.unused_indexes.row", {
                schema: r.schema,
                index: r.index,
                table: r.onTable,
                size: prettyBytes(r.sizeBytes),
              })}
            </td>
            <td className="row-actions" data-testid="unused-indexes-row-actions">
              <ActionButton
                kind="dropIndex"
                target={{
                  kind: "dropIndex",
                  schema: r.schema,
                  index: r.index,
                  onTable: r.onTable,
                  sizeBytes: r.sizeBytes,
                }}
                connId={connId}
              />
            </td>
          </tr>
))}
      </tbody>
    </table>
);

  return (    <CardShell
      cardId="unused_indexes"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
);
}
