import { type JSX, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "../../../lib/tauri";
import type { BlockingEdge, Session, SessionsSnapshot } from "../../../lib/tauri";
import { useHealthActions } from "../../health/actions/store";
import { useLiveOps } from "../store";

interface Props {
  snapshot: SessionsSnapshot;
  connId: string;
  conn: Connection;
}

interface Levels {
  /** ordered: index = level, value = pids in that level */
  rows: number[][];
  /** pid → level */
  levelOf: Map<number, number>;
  /** pid → set of pids that block this pid */
  blockersOf: Map<number, Set<number>>;
  /** pid → set of pids this pid blocks */
  waitersOf: Map<number, Set<number>>;
  /** pid → BlockingEdge with this blocked_pid (first match for label) */
  edgeFor: Map<number, BlockingEdge>;
  blockedCount: number;
}

function computeLevels(snap: SessionsSnapshot): Levels {
  const blockersOf = new Map<number, Set<number>>();
  const waitersOf = new Map<number, Set<number>>();
  const edgeFor = new Map<number, BlockingEdge>();

  const sessionPids = new Set<number>(snap.sessions.map((s) => s.pid));
  for (const e of snap.blockingEdges) {
    if (!sessionPids.has(e.blockedPid)) continue;
    if (!blockersOf.has(e.blockedPid)) blockersOf.set(e.blockedPid, new Set());
    blockersOf.get(e.blockedPid)?.add(e.blockerPid);
    if (sessionPids.has(e.blockerPid)) {
      if (!waitersOf.has(e.blockerPid)) waitersOf.set(e.blockerPid, new Set());
      waitersOf.get(e.blockerPid)?.add(e.blockedPid);
    }
    if (!edgeFor.has(e.blockedPid)) edgeFor.set(e.blockedPid, e);
  }

  // BFS: roots are sessions not blocked by anyone in the current snapshot.
  const levelOf = new Map<number, number>();
  const queue: Array<{ pid: number; level: number }> = [];
  for (const s of snap.sessions) {
    const blockers = blockersOf.get(s.pid);
    if (!blockers || blockers.size === 0) {
      queue.push({ pid: s.pid, level: 0 });
      levelOf.set(s.pid, 0);
    }
  }
  while (queue.length > 0) {
    const head = queue.shift();
    if (!head) break;
    const children = waitersOf.get(head.pid);
    if (!children) continue;
    for (const child of children) {
      const next = head.level + 1;
      const prev = levelOf.get(child) ?? -1;
      if (prev < next) {
        levelOf.set(child, next);
        queue.push({ pid: child, level: next });
      }
    }
  }

  // Cycle / orphan fallback — any session not assigned ends up in L0.
  for (const s of snap.sessions) {
    if (!levelOf.has(s.pid)) levelOf.set(s.pid, 0);
  }

  const rows: number[][] = [];
  for (const s of snap.sessions) {
    const lv = levelOf.get(s.pid) ?? 0;
    while (rows.length <= lv) rows.push([]);
    rows[lv].push(s.pid);
  }
  for (const r of rows) r.sort((a, b) => a - b);

  return { rows, levelOf, blockersOf, waitersOf, edgeFor, blockedCount: blockersOf.size };
}

function localizeState(
  t: (key: string, options?: { defaultValue: string }) => string,
  raw: string,
): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_|_$/g, "");
  return t(`live_ops.sessions.state.${slug}`, { defaultValue: raw });
}

function tone(s: Session, isBlocked: boolean): "blocked" | "active" | "idle-tx" | "idle" {
  if (isBlocked) return "blocked";
  if (s.state === "idle in transaction") return "idle-tx";
  if (s.state === "active") return "active";
  if (s.state === "idle") return "idle";
  return "active";
}

function shortQuery(q: string, max: number): string {
  const t = q.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

interface CardProps {
  session: Session;
  isBlocked: boolean;
  isBlocker: boolean;
  blockerEdge: BlockingEdge | null;
  highlighted: boolean;
  onTerminate: (s: Session) => void;
  onCancel: (s: Session) => void;
  onHighlightBlocker: (blockerPid: number) => void;
  registerRef: (pid: number, el: HTMLDivElement | null) => void;
}

function Card({
  session,
  isBlocked,
  isBlocker,
  blockerEdge,
  highlighted,
  onTerminate,
  onCancel,
  onHighlightBlocker,
  registerRef,
}: CardProps): JSX.Element {
  const { t } = useTranslation();
  const t1 = tone(session, isBlocked);
  const stateLabel = localizeState(t, session.state);
  const dur =
    session.durationSeconds !== null && session.durationSeconds >= 0
      ? `${Math.round(session.durationSeconds)} с`
      : null;
  return (
    <div
      ref={(el) => registerRef(session.pid, el)}
      className={`live-ops-card tone-${t1}${highlighted ? " is-highlighted" : ""}`}
      data-testid={`session-node-${session.pid}`}
      data-pid={session.pid}
      title={session.query}
    >
      <div className="card-row card-head">
        <span className="pid mono">pid {session.pid}</span>
        <span className="state-pill">
          {stateLabel}
          {dur ? ` · ${dur}` : ""}
        </span>
      </div>
      <div className="card-row meta">
        <span className="user-app">
          {session.username}
          {session.applicationName ? `@${session.applicationName}` : ""}
        </span>
      </div>
      {session.waitEvent !== null ? (
        <div className="card-row wait">
          <span className="wait-icon" aria-hidden="true">
            ⏳
          </span>
          <span>
            {t("live_ops.sessions.wait_short")}{" "}
            <span className="mono">
              {session.waitEventType ?? "?"}/{session.waitEvent}
            </span>
          </span>
        </div>
      ) : null}
      {isBlocked && blockerEdge ? (
        <div className="card-row meta lock-meta">
          <span className="lock-dot" aria-hidden="true" />
          {blockerEdge.lockType ? (
            <span className="mono">Lock/{blockerEdge.lockType}</span>
          ) : (
            <span className="mono">Lock</span>
          )}
          <span className="muted">·</span>
          <span>{t("live_ops.sessions.blocked_by", { pid: blockerEdge.blockerPid })}</span>
        </div>
      ) : null}
      <div className="card-row query mono">{shortQuery(session.query, 60)}</div>
      <div className="card-row actions">
        {isBlocked && blockerEdge ? (
          <>
            <button
              type="button"
              className="btn-ghost-sm"
              onClick={(e) => {
                e.stopPropagation();
                onHighlightBlocker(blockerEdge.blockerPid);
              }}
            >
              {t("live_ops.sessions.actions.highlight_blocker")}
            </button>
            <button
              type="button"
              className="btn-ghost-sm danger"
              onClick={(e) => {
                e.stopPropagation();
                onCancel(session);
              }}
            >
              {t("live_ops.sessions.actions.cancel")}
            </button>
          </>
        ) : isBlocker ? (
          <button
            type="button"
            className="btn-ghost-sm"
            onClick={(e) => {
              e.stopPropagation();
              onTerminate(session);
            }}
          >
            {t("live_ops.sessions.actions.terminate")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SessionsDag({ snapshot, connId, conn }: Props): JSX.Element {
  const { t } = useTranslation();
  const levels = useMemo(() => computeLevels(snapshot), [snapshot]);
  const sessionByPid = useMemo(() => {
    const m = new Map<number, Session>();
    for (const s of snapshot.sessions) m.set(s.pid, s);
    return m;
  }, [snapshot]);

  const [highlightedPid, setHighlightedPid] = useState<number | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const flashBlocker = (pid: number): void => {
    setHighlightedPid(pid);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightedPid(null);
      highlightTimer.current = null;
    }, 2000);
    const el = cardRefs.current.get(pid);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };
  useEffect(() => {
    return () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    };
  }, []);

  const onTerminate = (s: Session): void => {
    useHealthActions
      .getState()
      .openPreview({ kind: "killPid", pid: s.pid, query: s.query, terminate: true }, conn);
  };
  const onCancel = (s: Session): void => {
    useHealthActions
      .getState()
      .openPreview({ kind: "killPid", pid: s.pid, query: s.query, terminate: false }, conn);
  };

  // Card refs for arrow geometry
  const cardRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const registerRef = (pid: number, el: HTMLDivElement | null): void => {
    cardRefs.current.set(pid, el);
  };

  const [arrowVersion, setArrowVersion] = useState(0);
  // Re-attach the observer whenever the snapshot changes because the set
  // of card refs is rebuilt on every render of a new snapshot.
  const snapshotKey = snapshot.fetchedAt + snapshot.sessions.length;
  useLayoutEffect(() => {
    void snapshotKey;
    const stage = stageRef.current;
    if (!stage) return;
    setArrowVersion((v) => v + 1);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setArrowVersion((v) => v + 1));
    ro.observe(stage);
    for (const el of cardRefs.current.values()) {
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [snapshotKey]);

  // Left-click on the card opens the cancel/terminate menu next to the
  // cursor. Inline action buttons (terminate / cancel / highlight blocker)
  // stop propagation so they don't double-trigger the menu.
  const handleCardClick = (s: Session) => (e: React.MouseEvent) => {
    useLiveOps.getState().openContextMenu(connId, e.clientX, e.clientY, s);
  };

  // Build arrow segments from blockingEdges using current geometry
  const arrowSegs = useMemo(() => {
    void arrowVersion;
    const stage = stageRef.current;
    if (!stage) return [] as Array<{ id: string; d: string; from: number; to: number }>;
    const stageRect = stage.getBoundingClientRect();
    const segs: Array<{ id: string; d: string; from: number; to: number }> = [];
    for (const e of snapshot.blockingEdges) {
      const blockerEl = cardRefs.current.get(e.blockerPid);
      const blockedEl = cardRefs.current.get(e.blockedPid);
      if (!blockerEl || !blockedEl) continue;
      const a = blockerEl.getBoundingClientRect();
      const b = blockedEl.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - stageRect.left;
      const y1 = a.bottom - stageRect.top;
      const x2 = b.left + b.width / 2 - stageRect.left;
      const y2 = b.top - stageRect.top;
      const midY = (y1 + y2) / 2;
      // Smooth S-curve: cubic bezier with vertical control handles
      const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2 - 4}`;
      segs.push({ id: `${e.blockerPid}-${e.blockedPid}`, d, from: e.blockerPid, to: e.blockedPid });
    }
    return segs;
  }, [snapshot, arrowVersion]);

  // Stage size: enough to contain the SVG overlay. We use 100% within scroll container.
  return (
    <div className="live-ops-dag-stage" ref={stageRef}>
      <svg
        className="live-ops-arrow-overlay"
        aria-hidden="true"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
      >
        <defs>
          <marker
            id="live-ops-arrow-head"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {arrowSegs.map((seg) => (
          <path
            key={seg.id}
            d={seg.d}
            className="live-ops-arrow"
            markerEnd="url(#live-ops-arrow-head)"
          />
        ))}
      </svg>
      {levels.rows.map((pids, levelIdx) => {
        const labelKey =
          levelIdx === 0 ? "live_ops.sessions.level.blockers" : "live_ops.sessions.level.waiters_n";
        const label = t(labelKey, { n: levelIdx });
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: levelIdx is the structural identity of the level (L0, L1, ...)
          <section key={`level-${levelIdx}`} className="live-ops-dag-level">
            <header className="level-eyebrow">{label}</header>
            <div className="level-row">
              {pids.map((pid) => {
                const s = sessionByPid.get(pid);
                if (!s) return null;
                const blockers = levels.blockersOf.get(pid);
                const isBlocked = !!blockers && blockers.size > 0;
                const isBlocker = (levels.waitersOf.get(pid)?.size ?? 0) > 0;
                const blockerEdge = levels.edgeFor.get(pid) ?? null;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard equivalent is the right-click → S13 modal flow already wired in HealthActions; left-click here is a mouse-only convenience
                  <div
                    key={pid}
                    className="card-host"
                    onClick={handleCardClick(s)}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <Card
                      session={s}
                      isBlocked={isBlocked}
                      isBlocker={isBlocker}
                      blockerEdge={blockerEdge}
                      highlighted={highlightedPid === pid}
                      onTerminate={onTerminate}
                      onCancel={onCancel}
                      onHighlightBlocker={flashBlocker}
                      registerRef={registerRef}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function computeLevelsForTesting(snap: SessionsSnapshot): Levels {
  return computeLevels(snap);
}
