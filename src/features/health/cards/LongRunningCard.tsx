import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../actions/ActionButton";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";

interface CardProps {
  connId: string;
  state: CardState;
}

function truncate(s: string, max = 60): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function LongRunningCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "long_running") {
    return <CardShell cardId="long_running" connId={connId} state={state} />;
  }

  const rows = state.card.data.rows;
  if (rows.length === 0) {
    return (      <CardShell
        cardId="long_running"
        connId={connId}
        state={{ status: "empty", reason: "no_data" }}
      />
);
  }

  const tone = "warn" as const;

  const body = (    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
      <tbody>
        {rows.slice(0, 5).map((r) => (          <tr key={r.pid} data-testid="long-running-row">
            <td style={{ padding: "2px 4px", fontFamily: "var(--font-mono)" }}>
              {t("health.card.long_running.row", {
                pid: r.pid,
                duration: r.durationSeconds.toFixed(0),
                state: r.state,
              })}
            </td>
            <td
              style={{
                padding: "2px 4px",
                fontFamily: "var(--font-mono)",
                opacity: 0.75,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 160,
              }}
              title={r.query}
            >
              {truncate(r.query, 60)}
            </td>
            <td className="row-actions" data-testid="long-running-row-actions">
              <ActionButton
                kind="killPid"
                target={{ kind: "killPid", pid: r.pid, query: r.query }}
                connId={connId}
              />
            </td>
          </tr>
))}
      </tbody>
    </table>
);

  return (    <CardShell
      cardId="long_running"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
);
}
