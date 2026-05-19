// — TypeScript mirrors of Rust action types in
// `src-tauri/src/health/types.rs`. Keep the discriminator strings
// in lockstep — `serde(rename_all = "camelCase")` on the Rust side
// produces these exact wire forms.

export type ActionKind =
  | "reindexTable"
  | "vacuum"
  | "analyze"
  | "dropIndex"
  | "killPid"
  | "explain"; // Frontend-only branch — opens an editor tab; never invokes backend.

export type ActionTarget =
  | { kind: "reindexTable"; schema: string; table: string; sizeBytes?: number }
  | { kind: "vacuum"; schema: string; table: string; sizeBytes?: number }
  | { kind: "analyze"; schema: string; table: string }
  | { kind: "dropIndex"; schema: string; index: string; onTable: string; sizeBytes?: number }
  | { kind: "killPid"; pid: number; terminate?: boolean; query?: string }
  | { kind: "explain"; sql: string };

export type ActionStatus = "completed" | "notFound" | "terminated";

export interface ActionResult {
  actionId: string;
  durationMs: number;
  status: ActionStatus;
}

export type ActionError =
  | { kind: "notConnected" }
  | { kind: "forbidden"; required: string }
  | { kind: "activeTransaction" }
  | { kind: "objectNotFound"; target: string }
  | { kind: "queryFailed"; sqlstate: string; message: string };

export interface ProgressSnapshot {
  actionId: string;
  phase: string;
  percent: number | null;
  blocksScanned: number | null;
  blocksTotal: number | null;
  finished: boolean;
}
