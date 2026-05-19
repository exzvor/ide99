// — TS types for the Live Ops store + UI. Wire types live in
// src/lib/tauri.ts; this file holds store-internal types.

import type {
  ReplicationOverview,
  SessionsMode,
  SessionsSnapshot,
  SlowSnapshot,
  SlowSortBy,
} from "../../lib/tauri";

export type SubTab = "sessions" | "slow" | "replication";
export type SessionsView = "dag" | "list";

export type CardData<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T; fetchedAt: number }
  | { status: "unavailable"; extension: string; installSql: string }
  | { status: "forbidden"; requiredRole: string }
  | { status: "error"; message: string };

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  pid: number;
  query: string;
}

export interface PerConnState {
  activeSubTab: SubTab;
  sessions: {
    mode: SessionsMode;
    view: SessionsView;
    data: CardData<SessionsSnapshot>;
    intervalMs: number | null;
  };
  slow: { sortBy: SlowSortBy; data: CardData<SlowSnapshot>; intervalMs: number | null };
  replication: {
    showEmpty: boolean;
    data: CardData<ReplicationOverview>;
    intervalMs: number | null;
  };
  pollHandle: number | null;
  contextMenu: ContextMenuState;
  killPidUnsub: (() => void) | null;
}
