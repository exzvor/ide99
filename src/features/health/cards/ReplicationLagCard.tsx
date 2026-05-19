import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";
import { prettyBytes } from "./DbSizeCard";

interface CardProps {
  connId: string;
  state: CardState;
}

const TEN_MB = 10 * 1024 * 1024;
const HUNDRED_MB = 100 * 1024 * 1024;

function lagTone(maxBytes: number): "ok" | "warn" | "danger" {
  if (maxBytes > HUNDRED_MB) return "danger";
  if (maxBytes > TEN_MB) return "warn";
  return "ok";
}

export function ReplicationLagCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "replication_lag") {
    return <CardShell cardId="replication_lag" connId={connId} state={state} />;
  }

  const data = state.card.data;

  // streaming branch
  if (data.state === "streaming") {
    const maxBytes = data.slots.reduce((acc, s) => Math.max(acc, s.lagBytes ?? 0), 0);
    const tone = lagTone(maxBytes);
    const body = (      <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12 }}>
        {data.slots.map((s) => (          <li
            key={s.slot}
            data-testid="replication-slot-row"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {t("health.card.replication_lag.slot", {
              slot: s.slot,
              lag_bytes: s.lagBytes !== null ? prettyBytes(s.lagBytes) : "—",
              lag_seconds: s.lagSeconds !== null ? s.lagSeconds.toFixed(1) : "—",
            })}
          </li>
))}
      </ul>
);
    return (      <CardShell
        cardId="replication_lag"
        connId={connId}
        state={state}
        body={body}
        status={{ tone, tooltip: t(`health.status.${tone}`) }}
      />
);
  }

  // lagging branch
  if (data.state === "lagging") {
    const maxBytes = data.slots.reduce((acc, s) => Math.max(acc, s.lagBytes ?? 0), 0);
    const body = (      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          data-testid="replication-lag-badge"
          style={{
            alignSelf: "flex-start",
            padding: "2px 8px",
            borderRadius: 999,
            background: "var(--danger-q)",
            color: "white",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {prettyBytes(maxBytes)}
        </span>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12 }}>
          {data.slots.map((s) => (            <li
              key={s.slot}
              data-testid="replication-slot-row"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {t("health.card.replication_lag.slot", {
                slot: s.slot,
                lag_bytes: s.lagBytes !== null ? prettyBytes(s.lagBytes) : "—",
                lag_seconds: s.lagSeconds !== null ? s.lagSeconds.toFixed(1) : "—",
              })}
            </li>
))}
        </ul>
      </div>
);
    return (      <CardShell
        cardId="replication_lag"
        connId={connId}
        state={state}
        body={body}
        status={{ tone: "danger", tooltip: t("health.status.danger") }}
      />
);
  }

  // no_replicas — store should have already translated to empty, but defend.
  return (    <CardShell
      cardId="replication_lag"
      connId={connId}
      state={{ status: "empty", reason: "no_replicas" }}
    />
);
}
