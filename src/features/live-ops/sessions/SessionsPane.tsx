import { type JSX, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../../connections/store";
import { CardStateRouter } from "../CardStateRouter";
import { useLiveOps } from "../store";
import { SessionContextMenu } from "./SessionContextMenu";
import { SessionsDag } from "./SessionsDag";
import { SessionsList } from "./SessionsList";

interface Props {
  connId: string;
}

function pluralRu(count: number, key: (suffix: "one" | "few" | "many") => string): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n100 >= 11 && n100 <= 14) return key("many");
  if (n10 === 1) return key("one");
  if (n10 >= 2 && n10 <= 4) return key("few");
  return key("many");
}

export function SessionsPane({ connId }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const slice = useLiveOps((s) => s.byConn.get(connId));
  const conn = useConnections((s) => s.connections.find((c) => c.id === connId));
  // (a11y) — screen-reader-only summary that updates only when the
  // blocking-chain shape changes (sessions count or blocked-pid count). We
  // keep this above the early-return so React hook order stays stable when
  // the slice/conn are not yet hydrated. `aria-live="polite"` is the right
  // bucket per `09-accessibility.md` §3 — never assertive on a 2 s poll.
  const [chainSummary, setChainSummary] = useState<string>("");
  const lastSig = useRef<string>("");
  const ready = slice?.sessions?.data?.status === "ready" ? slice.sessions.data.data : null;

  // Build a stable signature so we only re-announce on real chain changes,
  // not every poll tick. Top blocker = pid blocking the most waiters.
  const totalSessions = ready?.sessions.length ?? 0;
  const blockedCount = ready ? new Set(ready.blockingEdges.map((e) => e.blockedPid)).size : 0;
  let topBlockerPid: number | null = null;
  let topBlockerCount = 0;
  if (ready) {
    const counts = new Map<number, number>();
    for (const e of ready.blockingEdges) {
      counts.set(e.blockerPid, (counts.get(e.blockerPid) ?? 0) + 1);
    }
    for (const [pid, n] of counts) {
      if (n > topBlockerCount) {
        topBlockerPid = pid;
        topBlockerCount = n;
      }
    }
  }
  const sig = `${totalSessions}|${blockedCount}|${topBlockerPid ?? "-"}|${topBlockerCount}`;

  useEffect(() => {
    if (!ready) {
      if (lastSig.current !== "") {
        lastSig.current = "";
        setChainSummary("");
      }
      return;
    }
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    if (blockedCount === 0 || topBlockerPid === null) {
      setChainSummary(t("live_ops.sessions.aria.chain_idle", { count: totalSessions }));
      return;
    }
    setChainSummary(
      t("live_ops.sessions.aria.chain_active", {
        sessions: totalSessions,
        blockerPid: topBlockerPid,
        blocked: topBlockerCount,
      }),
    );
  }, [sig, ready, blockedCount, topBlockerPid, topBlockerCount, totalSessions, t]);

  if (!slice || !conn) return null;
  const { view, data } = slice.sessions;

  const sessionsLabel = pluralRu(totalSessions, (s) =>
    t(`live_ops.sessions.summary.sessions_${s}`, { count: totalSessions }),
  );
  const summary =
    blockedCount > 0
      ? `${sessionsLabel} · ${t("live_ops.sessions.summary.blocked_count", { count: blockedCount })}`
      : sessionsLabel;

  return (
    <div className="live-ops-sessions" data-testid="live-ops-sessions">
      {/* (a11y, acceptance #4) — screen-reader announcement of
          blocking-chain state. Visually hidden, polite live region; the
          message changes only when the chain shape changes (see effect above)
          to avoid noisy re-announcements on every 2 s poll. */}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="live-ops-blocking-chain-aria"
      >
        {chainSummary}
      </div>
      <div className="live-ops-toolbar">
        <div role="radiogroup" aria-label={t("live_ops.sessions.view.dag")} className="seg">
          <button
            type="button"
            aria-pressed={view === "dag"}
            onClick={() => useLiveOps.getState().setSessionsView(connId, "dag")}
            data-testid="live-ops-view-dag"
          >
            {t("live_ops.sessions.view.dag")}
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => useLiveOps.getState().setSessionsView(connId, "list")}
            data-testid="live-ops-view-list"
          >
            {t("live_ops.sessions.view.list")}
          </button>
        </div>
        {ready ? (
          <span
            className={`live-ops-summary-chip${blockedCount > 0 ? " has-blocked" : ""}`}
            data-testid="live-ops-sessions-summary"
          >
            {summary}
          </span>
        ) : null}
      </div>

      <div className="live-ops-sessions-scroll">
        <CardStateRouter
          state={data}
          renderReady={(snap) =>
            snap.sessions.length === 0 ? (
              <div className="live-ops-shimmer">{t("live_ops.sessions.empty_all")}</div>
            ) : view === "dag" ? (
              <SessionsDag snapshot={snap} connId={connId} conn={conn} />
            ) : (
              <SessionsList snapshot={snap} connId={connId} />
            )
          }
        />
      </div>
      <SessionContextMenu connId={connId} />
    </div>
  );
}
