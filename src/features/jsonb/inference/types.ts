import type { Fqn, InferredSchema } from "../../../lib/tauri";

/**
 * — frontend cache entry shape per (connId, fqn).
 *
 * `pending` = first request fired, no schema available yet.
 * `ready`   = fresh schema in cache (stats-delta below threshold or first inference complete).
 * `stale`   = an older schema is cached, a refresh is in flight; UI may show
 * the old schema with a "Stale" badge while waiting for the event.
 * `error`   = the background task failed; UI shows the message + Retry.
 */
export type Entry =
  | { status: "pending" }
  | { status: "ready"; schema: InferredSchema }
  | { status: "stale"; schema: InferredSchema }
  | { status: "error"; message: string };

export type FqnKey = string;

/**
 * Stable key for the store's `byKey` and `pendingCallbacks` maps.
 * Format: `${connId}::${schema}::${table}::${column}`.
 */
export function fqnKey(connId: string, fqn: Fqn): FqnKey {
  return `${connId}::${fqn.schema}::${fqn.table}::${fqn.column}`;
}

export type { Fqn };
