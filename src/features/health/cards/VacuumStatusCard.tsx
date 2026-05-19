import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../actions/ActionButton";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";

interface CardProps {
  connId: string;
  state: CardState;
}

function vacuumTone(rows: { daysSince: number | null }[]): "ok" | "warn" | "danger" {
  let warn = false;
  for (const r of rows) {
    if (r.daysSince === null) {
      // never vacuumed → treat as danger
      return "danger";
    }
    if (r.daysSince > 30) return "danger";
    if (r.daysSince > 7) warn = true;
  }
  return warn ? "warn" : "ok";
}

export function VacuumStatusCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "vacuum_status") {
    return <CardShell cardId="vacuum_status" connId={connId} state={state} />;
  }

  const rows = state.card.data.rows;
  if (rows.length === 0) {
    return (
      <CardShell
        cardId="vacuum_status"
        connId={connId}
        state={{ status: "empty", reason: "no_data" }}
      />
    );
  }

  const tone = vacuumTone(rows);

  const body = (
    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
      <tbody>
        {rows.slice(0, 5).map((r) => (
          <tr key={`${r.schema}.${r.table}`} data-testid="vacuum-row">
            <td style={{ padding: "2px 4px", fontFamily: "var(--font-mono)" }}>
              {r.daysSince === null
                ? t("health.card.vacuum_status.row_never", {
                    schema: r.schema,
                    table: r.table,
                  })
                : t("health.card.vacuum_status.row", {
                    schema: r.schema,
                    table: r.table,
                    days: r.daysSince,
                  })}
            </td>
            <td className="row-actions" data-testid="vacuum-status-row-actions">
              <ActionButton
                kind="vacuum"
                target={{ kind: "vacuum", schema: r.schema, table: r.table }}
                connId={connId}
              />
              <ActionButton
                kind="analyze"
                target={{ kind: "analyze", schema: r.schema, table: r.table }}
                connId={connId}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <CardShell
      cardId="vacuum_status"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
  );
}
