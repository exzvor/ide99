import { type JSX, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Sparkline } from "../Sparkline";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";
import { prettyBytes } from "./DbSizeCard";

interface CardProps {
  connId: string;
  state: CardState;
}

/**
 * — WAL throughput card.
 *
 * The backend gives us a CUMULATIVE figure (`bytesPerSec` averaged since
 * `pg_stat_wal.stats_reset`). To draw a useful sparkline of recent
 * activity we keep a tiny rolling buffer of samples between refreshes
 * here on the client — purely cosmetic, lost on unmount, no persistence.
 */
const SPARKLINE_LIMIT = 16;

const recentSamplesByConn = new Map<string, number[]>();

function pushSample(connId: string, bytesPerSec: number): number[] {
  const cur = recentSamplesByConn.get(connId) ?? [];
  const next = [...cur, bytesPerSec];
  while (next.length > SPARKLINE_LIMIT) next.shift();
  recentSamplesByConn.set(connId, next);
  return next;
}

function formatRelativeSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(1)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} kB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

export function WalThroughputCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();
  const lastSampleRef = useRef<number | null>(null);

  // Push a new sample into the per-connection ring buffer when we get a
  // fresh number from the backend. Hooks are top-level — sampling key is
  // the bytesPerSec value so we only push on actual changes.
  const sample =
    state.status === "ready" && state.card.id === "wal_throughput"
      ? state.card.data.bytesPerSec
      : null;
  useEffect(() => {
    if (sample === null) return;
    if (lastSampleRef.current === sample) return;
    lastSampleRef.current = sample;
    pushSample(connId, sample);
  }, [connId, sample]);

  if (state.status !== "ready" || state.card.id !== "wal_throughput") {
    return <CardShell cardId="wal_throughput" connId={connId} state={state} />;
  }

  const data = state.card.data;
  const samples = recentSamplesByConn.get(connId) ?? [data.bytesPerSec];
  const tone = "ok" as const;

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 22, fontWeight: 600 }} data-testid="wal-throughput-rate">
        {data.secondsSinceReset > 0
          ? formatRate(data.bytesPerSec)
          : t("health.card.wal_throughput.no_data")}
      </div>
      {data.secondsSinceReset > 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
          {t("health.card.wal_throughput.since_reset", {
            relative: formatRelativeSeconds(data.secondsSinceReset),
          })}{" "}
          · {prettyBytes(data.totalBytes)}
        </div>
      ) : null}
      {samples.length >= 2 ? (
        <Sparkline data={samples} ariaLabel={t("health.card.wal_throughput.title")} />
      ) : null}
    </div>
  );

  return (
    <CardShell
      cardId="wal_throughput"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
  );
}
