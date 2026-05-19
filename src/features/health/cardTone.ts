/**
 *  — derive a coarse health-card tone from its CardState so the
 * Health header can show "N critical / N warning / N ok" pills without
 * coupling to each card component's local tone heuristic.
 *
 * Each branch mirrors what the corresponding card itself decides in its
 * own render — keep them in sync if a card's tone logic changes.
 */

import type {
  ActiveConnectionsData,
  BloatTopData,
  CacheHitData,
  LongRunningData,
  MissingIndexesData,
  ReplicationLagData,
  SlowQueriesData,
  UnusedIndexesData,
  VacuumStatusData,
} from "../../lib/tauri";
import type { CardId, CardState } from "./store";

export type CardTone = "ok" | "warn" | "danger";

export function classifyCardTone(cardId: CardId, state: CardState): CardTone | null {
  if (state.status === "loading") return null;
  if (state.status === "error") return "danger";
  if (state.status === "unavailable" || state.status === "forbidden") return "warn";
  if (state.status === "empty") return "ok";
  if (state.status !== "ready") return null;

  switch (cardId) {
    case "bloat": {
      const data = state.card.data as BloatTopData;
      const maxPct = data.rows.reduce((a, r) => Math.max(a, r.bloatPct), 0);
      if (maxPct > 30) return "danger";
      if (maxPct > 15) return "warn";
      return "ok";
    }
    case "db_size":
      return "ok";
    case "unused_indexes": {
      const data = state.card.data as UnusedIndexesData;
      return data.rows.length > 0 ? "warn" : "ok";
    }
    case "vacuum_status": {
      const data = state.card.data as VacuumStatusData;
      const hasNever = data.rows.some((r) => r.lastVacuum === null);
      return hasNever ? "warn" : "ok";
    }
    case "long_running": {
      const data = state.card.data as LongRunningData;
      return data.rows.length > 0 ? "danger" : "ok";
    }
    case "active_connections": {
      const data = state.card.data as ActiveConnectionsData;
      const pct = data.max > 0 ? data.current / data.max : 0;
      if (pct > 0.9) return "danger";
      if (pct > 0.7) return "warn";
      return "ok";
    }
    case "cache_hit": {
      const data = state.card.data as CacheHitData;
      if (data.ratioPct < 95) return "warn";
      return "ok";
    }
    case "missing_indexes": {
      const data = state.card.data as MissingIndexesData;
      return data.rows.length > 0 ? "warn" : "ok";
    }
    case "slow_queries": {
      const data = state.card.data as SlowQueriesData;
      return data.rows.length > 0 ? "warn" : "ok";
    }
    case "replication_lag": {
      const data = state.card.data as ReplicationLagData;
      if (data.state === "no_replicas") return "ok";
      const maxLag = data.slots.reduce((acc, s) => Math.max(acc, s.lagBytes ?? 0), 0);
      if (maxLag > 5_000_000_000) return "danger";
      if (maxLag > 1_000_000_000) return "warn";
      return "ok";
    }
    case "wal_throughput":
      // Throughput is informational — never flagged as warn/danger purely
      // by rate (high WAL volume can be normal). Health card just shows
      // current rate; an alerting system would set its own thresholds.
      return "ok";
    case "jsonb_index_suggestions": {
      // warn if there are actionable suggestions, ok if no suggestions.
      const data = state.card.data as import("./store").JsonbIndexSuggestionsData;
      return data.rows.length > 0 ? "warn" : "ok";
    }
    default:
      return null;
  }
}
