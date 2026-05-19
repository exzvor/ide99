import type { CardId } from "../store";
import type { ActionKind } from "./types";

/** After a successful action, refresh these cards on the source connection. */
export const ACTION_REFRESH: Record<ActionKind, readonly CardId[]> = {
  reindexTable: ["bloat", "unused_indexes"],
  vacuum: ["vacuum_status", "bloat"],
  analyze: ["vacuum_status"],
  dropIndex: ["unused_indexes", "db_size"],
  killPid: ["long_running", "active_connections"],
  explain: [],
} as const;
