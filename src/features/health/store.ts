// — Health Screen store.
//
// Owns per-connection card state for the Health tab. `refreshAll` fans
// out 10 IPC calls in parallel via `Promise.allSettled`, translates
// each `CardResult<T>` into a discriminated `CardState`, and applies
// empty-positive special cases (no replicas, empty long-running, empty
// slow queries). On a successful db_size response the store also fires
// `healthSnapshotsSave` (≥1h dedup is enforced backend-side).

import { create } from "zustand";
import {
  type ActiveConnectionsData,
  type BloatTopData,
  type CacheHitData,
  type CardResult,
  type DbSizeData,
  type Environment,
  type LongRunningData,
  type MissingIndexesData,
  type OpClass,
  type ReplicationLagData,
  type SlowQueriesData,
  type UnusedIndexesData,
  type VacuumStatusData,
  type WalThroughputData,
  healthActiveConnections,
  healthBloat,
  healthCacheHit,
  healthDbSize,
  healthLongRunning,
  healthMissingIndexes,
  healthReplicationLag,
  healthSlowQueries,
  healthSnapshotsSave,
  healthUnusedIndexes,
  healthVacuumStatus,
  healthWalThroughput,
  jsonbSuggesterRun,
} from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { loadInterval, saveInterval } from "./refreshInterval";

export type CardId =
  | "db_size"
  | "bloat"
  | "slow_queries"
  | "missing_indexes"
  | "unused_indexes"
  | "cache_hit"
  | "active_connections"
  | "long_running"
  | "vacuum_status"
  | "replication_lag"
  | "wal_throughput"
  | "jsonb_index_suggestions";

export const ALL_CARDS: readonly CardId[] = [
  "db_size",
  "bloat",
  "slow_queries",
  "missing_indexes",
  "unused_indexes",
  "cache_hit",
  "active_connections",
  "long_running",
  "vacuum_status",
  "replication_lag",
  "wal_throughput",
  "jsonb_index_suggestions",
] as const;

export interface JsonbIndexSuggestionRow {
  schema: string;
  table: string;
  column: string;
  op: string;
  calls: number;
  totalExecTimeMs: number;
  recommendedSql: string;
  indexName: string;
}

/** True when pg_stat_statements was unavailable and rows is empty due to that. */
export interface JsonbIndexSuggestionsData {
  rows: JsonbIndexSuggestionRow[];
  pgStatStatementsUnavailable: boolean;
  pgStatStatementsInstallSql: string;
}

export type CardData =
  | { id: "db_size"; data: DbSizeData }
  | { id: "bloat"; data: BloatTopData }
  | { id: "slow_queries"; data: SlowQueriesData }
  | { id: "missing_indexes"; data: MissingIndexesData }
  | { id: "unused_indexes"; data: UnusedIndexesData }
  | { id: "cache_hit"; data: CacheHitData }
  | { id: "active_connections"; data: ActiveConnectionsData }
  | { id: "long_running"; data: LongRunningData }
  | { id: "vacuum_status"; data: VacuumStatusData }
  | { id: "replication_lag"; data: ReplicationLagData }
  | { id: "wal_throughput"; data: WalThroughputData }
  | { id: "jsonb_index_suggestions"; data: JsonbIndexSuggestionsData };

export type CardState =
  | { status: "loading" }
  | { status: "ready"; card: CardData }
  | { status: "empty"; reason: "no_data" | "no_replicas" }
  | { status: "unavailable"; extension: string; installSql: string }
  | { status: "forbidden"; requiredRole: string }
  | { status: "error"; message: string };

export interface PerConnState {
  cards: Map<CardId, CardState>;
  lastRefreshAt: number | null;
  refreshInProgress: boolean;
  refreshIntervalMs: number | null;
}

export interface HealthState {
  byConn: Map<string, PerConnState>;
}

export interface HealthActions {
  ensureConn(connectionId: string): PerConnState;
  forConn(connectionId: string): PerConnState;
  refreshAll(connectionId: string): Promise<void>;
  refreshOne(connectionId: string, cardId: CardId): Promise<void>;
  setRefreshInterval(connectionId: string, ms: number | null): void;
  clearConn(connectionId: string): void;
}

export type HealthStore = HealthState & HealthActions;

function defaultPerConn(): PerConnState {
  return {
    cards: new Map(),
    lastRefreshAt: null,
    refreshInProgress: false,
    refreshIntervalMs: null,
  };
}

function envFor(connectionId: string): Environment {
  const conn = useConnections.getState().connections.find((c) => c.id === connectionId);
  return conn?.environment ?? "local";
}

/** OpClass → display label for health card rows. */
function opLabel(op: OpClass): string {
  switch (op.kind) {
    case "jsonbOps":
      return "@>";
    case "jsonbPathOps":
      return "@?";
    case "expression":
      return op.expr;
  }
}

/** CardResult<T> → CardState, applying empty-positive special cases. */
function translateResult<T>(cardId: CardId, result: CardResult<T>): CardState {
  if (!result.ok) {
    const err = result.error;
    switch (err.kind) {
      case "unavailable":
        return {
          status: "unavailable",
          extension: err.extension,
          installSql: err.installSql,
        };
      case "forbidden":
        return { status: "forbidden", requiredRole: err.requiredRole };
      case "queryFailed":
        return { status: "error", message: err.message };
      case "notConnected":
        return { status: "error", message: "editor.run.no_connection" };
    }
  }
  // ok: true — apply empty-positive translation per card.
  if (cardId === "replication_lag") {
    const data = result.data as ReplicationLagData;
    if (data.state === "no_replicas") {
      return { status: "empty", reason: "no_replicas" };
    }
  }
  if (cardId === "long_running") {
    const data = result.data as LongRunningData;
    if (data.rows.length === 0) return { status: "empty", reason: "no_data" };
  }
  if (cardId === "slow_queries") {
    const data = result.data as SlowQueriesData;
    if (data.rows.length === 0) return { status: "empty", reason: "no_data" };
  }
  if (cardId === "jsonb_index_suggestions") {
    const data = result.data as JsonbIndexSuggestionsData;
    if (data.pgStatStatementsUnavailable) {
      return {
        status: "unavailable",
        extension: "pg_stat_statements",
        installSql: data.pgStatStatementsInstallSql,
      };
    }
    // When pg_stat_statements IS available but rows is empty, return
    // ready so the card can render the S17-specific empty copy. Do NOT return
    // generic empty/no_data — that bypasses the card's own empty render logic.
  }
  return {
    status: "ready",
    card: { id: cardId, data: result.data } as CardData,
  };
}

/** Per-card IPC dispatch. Order mirrors `ALL_CARDS`. */
function fetchCard(cardId: CardId, connectionId: string): Promise<CardResult<unknown>> {
  switch (cardId) {
    case "db_size":
      return healthDbSize(connectionId) as Promise<CardResult<unknown>>;
    case "bloat":
      return healthBloat(connectionId) as Promise<CardResult<unknown>>;
    case "slow_queries":
      return healthSlowQueries(connectionId) as Promise<CardResult<unknown>>;
    case "missing_indexes":
      return healthMissingIndexes(connectionId) as Promise<CardResult<unknown>>;
    case "unused_indexes":
      return healthUnusedIndexes(connectionId) as Promise<CardResult<unknown>>;
    case "cache_hit":
      return healthCacheHit(connectionId) as Promise<CardResult<unknown>>;
    case "active_connections":
      return healthActiveConnections(connectionId) as Promise<CardResult<unknown>>;
    case "long_running":
      return healthLongRunning(connectionId) as Promise<CardResult<unknown>>;
    case "vacuum_status":
      return healthVacuumStatus(connectionId) as Promise<CardResult<unknown>>;
    case "replication_lag":
      return healthReplicationLag(connectionId) as Promise<CardResult<unknown>>;
    case "wal_throughput":
      return healthWalThroughput(connectionId) as Promise<CardResult<unknown>>;
    case "jsonb_index_suggestions": {
      return jsonbSuggesterRun(connectionId, { kind: "global" }).then((result) => {
        const pgStatAvail = result.extensions.pgStatStatements.kind === "available";
        const pgStatInstallSql =
          result.extensions.pgStatStatements.kind === "unavailable"
            ? result.extensions.pgStatStatements.installSql
            : "";
        const rows: JsonbIndexSuggestionRow[] = result.suggestions.map((s) => ({
          schema: s.schema,
          table: s.table,
          column: s.column,
          op: opLabel(s.opClass),
          calls: s.rationale.kind === "mined" ? s.rationale.calls : 0,
          totalExecTimeMs: s.rationale.kind === "mined" ? s.rationale.totalExecTimeMs : 0,
          recommendedSql: s.recommendedSql,
          indexName: s.indexName,
        }));
        return {
          ok: true,
          data: {
            rows,
            pgStatStatementsUnavailable: !pgStatAvail,
            pgStatStatementsInstallSql: pgStatInstallSql,
          },
        } satisfies CardResult<JsonbIndexSuggestionsData>;
      }) as Promise<CardResult<unknown>>;
    }
  }
}

/** Settled→CardState; rejected promises map to a generic queryFailed error. */
function settledToState<T>(  cardId: CardId,
  settled: PromiseSettledResult<CardResult<T>>,
): CardState {
  if (settled.status === "fulfilled") {
    return translateResult(cardId, settled.value);
  }
  const reason = settled.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  return { status: "error", message };
}

function copyByConn(byConn: Map<string, PerConnState>): Map<string, PerConnState> {
  return new Map(byConn);
}

function withSlice(  byConn: Map<string, PerConnState>,
  connectionId: string,
  slice: PerConnState,
): Map<string, PerConnState> {
  const next = copyByConn(byConn);
  next.set(connectionId, slice);
  return next;
}

export const useHealth = create<HealthStore>((set, get) => ({
  byConn: new Map(),

  ensureConn: (connectionId) => {
    const existing = get().byConn.get(connectionId);
    if (existing) return existing;
    const env = envFor(connectionId);
    const slice: PerConnState = {
      ...defaultPerConn(),
      refreshIntervalMs: loadInterval(connectionId, env),
    };
    set((s) => ({ byConn: withSlice(s.byConn, connectionId, slice) }));
    return slice;
  },

  forConn: (connectionId) => {
    return get().byConn.get(connectionId) ?? defaultPerConn();
  },

  refreshAll: async (connectionId) => {
    // Make sure the slice exists (and the env-cap interval is loaded).
    get().ensureConn(connectionId);

    // Mark every card as loading and flip refreshInProgress.
    set((s) => {
      const prev = s.byConn.get(connectionId) ?? defaultPerConn();
      const cards = new Map<CardId, CardState>();
      for (const id of ALL_CARDS) cards.set(id, { status: "loading" });
      const slice: PerConnState = { ...prev, cards, refreshInProgress: true };
      return { byConn: withSlice(s.byConn, connectionId, slice) };
    });

    const results = await Promise.allSettled(ALL_CARDS.map((id) => fetchCard(id, connectionId)));

    // Snapshot side-effect — fire-and-forget on db_size success only.
    const dbSizeIdx = ALL_CARDS.indexOf("db_size");
    const dbSizeSettled = results[dbSizeIdx];
    if (dbSizeSettled?.status === "fulfilled" && dbSizeSettled.value.ok) {
      const data = dbSizeSettled.value.data as DbSizeData;
      void healthSnapshotsSave(connectionId, data.bytes).catch(() => {
        // swallow — snapshot persistence is best-effort
      });
    }

    // Translate each settled result and commit.
    set((s) => {
      const prev = s.byConn.get(connectionId) ?? defaultPerConn();
      const cards = new Map<CardId, CardState>(prev.cards);
      ALL_CARDS.forEach((id, i) => {
        cards.set(id, settledToState(id, results[i]));
      });
      const slice: PerConnState = {
        ...prev,
        cards,
        lastRefreshAt: Date.now(),
        refreshInProgress: false,
      };
      return { byConn: withSlice(s.byConn, connectionId, slice) };
    });
  },

  refreshOne: async (connectionId, cardId) => {
    get().ensureConn(connectionId);

    set((s) => {
      const prev = s.byConn.get(connectionId) ?? defaultPerConn();
      const cards = new Map<CardId, CardState>(prev.cards);
      cards.set(cardId, { status: "loading" });
      return { byConn: withSlice(s.byConn, connectionId, { ...prev, cards }) };
    });

    let nextState: CardState;
    try {
      const result = await fetchCard(cardId, connectionId);
      nextState = translateResult(cardId, result);
      if (cardId === "db_size" && result.ok) {
        const data = result.data as DbSizeData;
        void healthSnapshotsSave(connectionId, data.bytes).catch(() => {
          // swallow
        });
      }
    } catch (e) {
      nextState = {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }

    set((s) => {
      const prev = s.byConn.get(connectionId) ?? defaultPerConn();
      const cards = new Map<CardId, CardState>(prev.cards);
      cards.set(cardId, nextState);
      return { byConn: withSlice(s.byConn, connectionId, { ...prev, cards }) };
    });
  },

  setRefreshInterval: (connectionId, ms) => {
    saveInterval(connectionId, ms);
    set((s) => {
      const prev = s.byConn.get(connectionId) ?? defaultPerConn();
      return {
        byConn: withSlice(s.byConn, connectionId, {
          ...prev,
          refreshIntervalMs: ms,
        }),
      };
    });
  },

  clearConn: (connectionId) => {
    set((s) => {
      if (!s.byConn.has(connectionId)) return s;
      const next = copyByConn(s.byConn);
      next.delete(connectionId);
      return { byConn: next };
    });
  },
}));
