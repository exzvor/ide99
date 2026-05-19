import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";

interface CardProps {
  connId: string;
  state: CardState;
}

function cacheTone(pct: number): "ok" | "warn" | "danger" {
  if (pct >= 95) return "ok";
  if (pct >= 85) return "warn";
  return "danger";
}

export function CacheHitCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "cache_hit") {
    return <CardShell cardId="cache_hit" connId={connId} state={state} />;
  }

  const ratio = state.card.data.ratioPct;
  const tone = cacheTone(ratio);
  const barColor =
    tone === "ok" ? "var(--accent)" : tone === "warn" ? "var(--warning-500)" : "var(--danger-q)";

  const clamped = Math.max(0, Math.min(100, ratio));

  const body = (    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 22, fontWeight: 600 }} data-testid="cache-hit-pct">
        {ratio.toFixed(2)}%
      </div>
      <div
        role="progressbar"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        data-testid="cache-hit-bar"
        style={{
          height: 6,
          borderRadius: 3,
          background: "var(--bg-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            background: barColor,
            transition: "width 240ms ease-out",
          }}
        />
      </div>
    </div>
);

  return (    <CardShell
      cardId="cache_hit"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
);
}
