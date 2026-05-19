import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Sparkline } from "../Sparkline";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";

interface CardProps {
  connId: string;
  state: CardState;
}

const UNITS = ["B", "kB", "MB", "GB", "TB", "PB"];

/**
 * Pretty-print a byte count à la `pg_size_pretty` (1024-base, 1 fractional
 * digit). Negative values render with a leading `-`. Used by DbSize growth
 * line, UnusedIndexesCard total, ReplicationLagCard lag.
 */
export function prettyBytes(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const sign = n < 0 ? "-" : "";
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const fixed = v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1);
  return `${sign}${fixed} ${UNITS[i]}`;
}

function growthTone(growthPct: number | null | undefined): "ok" | "warn" | "danger" {
  if (growthPct === null || growthPct === undefined) return "ok";
  const pct = Math.abs(growthPct);
  if (pct < 5) return "ok";
  if (pct <= 20) return "warn";
  return "danger";
}

export function DbSizeCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "db_size") {
    return <CardShell cardId="db_size" connId={connId} state={state} />;
  }

  const data = state.card.data;
  const points = data.sparklinePoints;
  const collecting = points.length < 7;

  const tone = growthTone(data.growth7dPct);
  const status = { tone, tooltip: t(`health.status.${tone}`) };

  const growthLabel: string | null = (() => {
    if (collecting) {
      return t("health.card.db_size.growth_collecting", { points: points.length });
    }
    if (data.growth7dBytes === null || data.growth7dPct === null) return null;
    const sign = data.growth7dBytes >= 0 ? "+" : "";
    const delta = `${sign}${prettyBytes(data.growth7dBytes)}`;
    const pct = `${data.growth7dPct >= 0 ? "+" : ""}${data.growth7dPct.toFixed(1)}%`;
    return t("health.card.db_size.growth", { delta, pct });
  })();

  const growthColor =
    tone === "ok" ? "var(--accent)" : tone === "warn" ? "var(--warning-500)" : "var(--danger-q)";

  const body = (    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 22, fontWeight: 600 }} data-testid="db-size-pretty">
        {data.pretty}
      </div>
      {growthLabel ? (        <div style={{ fontSize: 12, color: growthColor }} data-testid="db-size-growth">
          {growthLabel}
        </div>
) : null}
      {points.length >= 1 ? (        <Sparkline data={points} ariaLabel={t("health.card.db_size.title")} />
) : null}
    </div>
);

  return <CardShell cardId="db_size" connId={connId} state={state} body={body} status={status} />;
}
