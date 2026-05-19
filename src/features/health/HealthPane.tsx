import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEditor } from "../editor/store";
import { HealthHeader } from "./HealthHeader";
import { ALL_CARDS, type CardId, type CardState, useHealth } from "./store";

import { ActiveConnectionsCard } from "./cards/ActiveConnectionsCard";
import { BloatCard } from "./cards/BloatCard";
import { CacheHitCard } from "./cards/CacheHitCard";
import { DbSizeCard } from "./cards/DbSizeCard";
import { JsonbIndexSuggestionsCard } from "./cards/JsonbIndexSuggestionsCard";
import { LongRunningCard } from "./cards/LongRunningCard";
import { MissingIndexesCard } from "./cards/MissingIndexesCard";
import { ReplicationLagCard } from "./cards/ReplicationLagCard";
import { SlowQueriesCard } from "./cards/SlowQueriesCard";
import { UnusedIndexesCard } from "./cards/UnusedIndexesCard";
import { VacuumStatusCard } from "./cards/VacuumStatusCard";
import { WalThroughputCard } from "./cards/WalThroughputCard";

interface HealthPaneProps {
  connId: string;
}

const DEFAULT_LOADING: CardState = { status: "loading" };

const CARD_COMPONENTS: Record<
  CardId,
  (props: { connId: string; state: CardState }) => JSX.Element
> = {
  db_size: DbSizeCard,
  bloat: BloatCard,
  slow_queries: SlowQueriesCard,
  missing_indexes: MissingIndexesCard,
  unused_indexes: UnusedIndexesCard,
  cache_hit: CacheHitCard,
  active_connections: ActiveConnectionsCard,
  long_running: LongRunningCard,
  vacuum_status: VacuumStatusCard,
  replication_lag: ReplicationLagCard,
  wal_throughput: WalThroughputCard,
  jsonb_index_suggestions: JsonbIndexSuggestionsCard,
};

/**
 * — three semantic groups (storage / connections-cache /
 * queries-replication). Layout uses fixed-width tracks (320px each, 4
 * per group) so cards never shrink — when the viewport gets narrower
 * the outer wrapper scrolls horizontally instead. Eyebrow titles
 * mirror the mockup.
 */
const CARD_GROUPS: ReadonlyArray<{
  id: string;
  titleKey: string;
  cards: readonly CardId[];
}> = [
  {
    id: "storage",
    titleKey: "health.group.storage",
    cards: ["bloat", "db_size", "unused_indexes", "vacuum_status"],
  },
  {
    id: "connections_cache",
    titleKey: "health.group.connections_cache",
    cards: ["long_running", "active_connections", "cache_hit", "missing_indexes"],
  },
  {
    id: "queries_replication",
    titleKey: "health.group.queries_replication",
    cards: ["slow_queries", "replication_lag", "wal_throughput", "jsonb_index_suggestions"],
  },
];

const COLUMN_WIDTH = 320;
const COLUMN_GAP = 16;
const COLUMNS_PER_GROUP = 4;
const GROUP_MIN_WIDTH = COLUMN_WIDTH * COLUMNS_PER_GROUP + COLUMN_GAP * (COLUMNS_PER_GROUP - 1);

/**
 * — host of a HealthTab.
 *
 * Effects:
 * 1. First-mount → refreshAll(connId).
 * 2. Auto-refresh interval governed by `refreshIntervalMs` + visibilitychange
 * pause/resume (spec §6.6).
 * 3. Cmd/Ctrl+R hotkey, scoped to this tab via `activeTabId === health-${connId}`.
 */
export function HealthPane({ connId }: HealthPaneProps): JSX.Element {
  const { t } = useTranslation();
  const slice = useHealth((s) => s.byConn.get(connId));
  const cards = slice?.cards;
  const lastRefreshAt = slice?.lastRefreshAt ?? null;
  const refreshIntervalMs = slice?.refreshIntervalMs ?? null;
  const refreshInProgress = slice?.refreshInProgress ?? false;

  // 1) First-mount refresh.
  useEffect(() => {
    void useHealth.getState().refreshAll(connId);
  }, [connId]);

  // 2) Auto-refresh interval + visibilitychange pause/resume.
  useEffect(() => {
    if (refreshIntervalMs === null) return;
    let handle: number | null = null;

    function start(): void {
      if (handle !== null) return;
      handle = window.setInterval(() => {
        void useHealth.getState().refreshAll(connId);
      }, refreshIntervalMs as number);
    }
    function stop(): void {
      if (handle !== null) {
        window.clearInterval(handle);
        handle = null;
      }
    }
    function onVisibility(): void {
      if (document.visibilityState === "visible") {
        void useHealth.getState().refreshAll(connId);
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshIntervalMs, connId]);

  // 3) Cmd/Ctrl+R hotkey — only when this tab is active.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key !== "r") return;
      if (useEditor.getState().activeTabId !== `health-${connId}`) return;
      e.preventDefault();
      e.stopPropagation();
      void useHealth.getState().refreshAll(connId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connId]);

  function renderCard(cardId: CardId): JSX.Element {
    const Component = CARD_COMPONENTS[cardId];
    const state = cards?.get(cardId) ?? DEFAULT_LOADING;
    return (
      <div key={cardId} style={{ width: COLUMN_WIDTH }}>
        <Component connId={connId} state={state} />
      </div>
    );
  }

  // Cards not assigned to a group (defensive — surface them at the end so
  // we never silently drop a future ALL_CARDS extension).
  const groupedIds = new Set(CARD_GROUPS.flatMap((g) => g.cards));
  const ungrouped = ALL_CARDS.filter((id) => !groupedIds.has(id));

  return (
    <div
      data-testid="health-pane"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      <HealthHeader
        connId={connId}
        lastRefreshAt={lastRefreshAt}
        refreshIntervalMs={refreshIntervalMs}
        refreshInProgress={refreshInProgress}
      />
      <div
        data-testid="health-grid"
        className="q-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            // Critical: minimum width = enough room for 4 fixed cards.
            // The outer wrapper's overflow: auto provides horizontal
            // scroll when the viewport is narrower than this.
            minWidth: GROUP_MIN_WIDTH,
          }}
        >
          {CARD_GROUPS.map((group) => (
            <section
              key={group.id}
              data-testid={`health-group-${group.id}`}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 500,
                }}
              >
                {t(group.titleKey)}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${COLUMNS_PER_GROUP}, ${COLUMN_WIDTH}px)`,
                  gap: COLUMN_GAP,
                }}
              >
                {group.cards.map(renderCard)}
              </div>
            </section>
          ))}
          {ungrouped.length > 0 ? (
            <section
              data-testid="health-group-other"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 500,
                }}
              >
                {t("health.group.other")}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${COLUMNS_PER_GROUP}, ${COLUMN_WIDTH}px)`,
                  gap: COLUMN_GAP,
                }}
              >
                {ungrouped.map(renderCard)}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
