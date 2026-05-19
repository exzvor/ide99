// — Live Ops user preferences (per-connection).
//
// Persisted to localStorage keyed by `${LIVE_OPS_PREFS_LS_PREFIX}${connId}`.
// `loadPrefs` validates with a zod schema versioned by `schemaVersion`. On
// any mismatch (missing/invalid/legacy version) defaults are returned.
// An env-cap pass also auto-corrects polling intervals that are too tight
// for the connection's environment (prod/stage min 2s, local/dev min 1s).

import { z } from "zod";
import type { Environment } from "../../lib/tauri";

export const LIVE_OPS_PREFS_LS_PREFIX = "ide99:liveops:";
export const LIVE_OPS_PREFS_SCHEMA_VERSION = 1 as const;

const subTabSchema = z.enum(["sessions", "slow", "replication"]);
const sessionsModeSchema = z.enum(["all", "blocked"]);
const sessionsViewSchema = z.enum(["dag", "list"]);
const slowSortBySchema = z.enum(["meanExecTime", "totalExecTime", "calls", "meanRows"]);

const sessionsPrefsSchema = z.object({
  mode: sessionsModeSchema.default("blocked"),
  view: sessionsViewSchema.default("dag"),
  intervalMs: z.number().int().nullable().default(2000),
});
const slowPrefsSchema = z.object({
  sortBy: slowSortBySchema.default("meanExecTime"),
  intervalMs: z.number().int().nullable().default(5000),
});
const replicationPrefsSchema = z.object({
  showEmpty: z.boolean().default(false),
  intervalMs: z.number().int().nullable().default(5000),
});

export const liveOpsPrefsSchema = z.object({
  schemaVersion: z.literal(LIVE_OPS_PREFS_SCHEMA_VERSION),
  activeSubTab: subTabSchema.default("sessions"),
  sessions: sessionsPrefsSchema.default({}),
  slow: slowPrefsSchema.default({}),
  replication: replicationPrefsSchema.default({}),
});
export type LiveOpsPrefs = z.infer<typeof liveOpsPrefsSchema>;

function defaultsFor(env: Environment): LiveOpsPrefs {
  return liveOpsPrefsSchema.parse({
    schemaVersion: LIVE_OPS_PREFS_SCHEMA_VERSION,
    activeSubTab: "sessions",
    sessions: {
      mode: "all",
      view: "dag",
      intervalMs: env === "prod" || env === "stage" ? 5000 : 2000,
    },
    slow: { sortBy: "meanExecTime", intervalMs: 5000 },
    replication: { showEmpty: false, intervalMs: 5000 },
  });
}

function envCapMs(env: Environment): number {
  return env === "prod" || env === "stage" ? 2000 : 1000;
}

function applyEnvCap(prefs: LiveOpsPrefs, env: Environment): LiveOpsPrefs {
  const cap = envCapMs(env);
  const fix = (ms: number | null): number | null => (ms === null ? null : Math.max(ms, cap));
  return {
    ...prefs,
    sessions: { ...prefs.sessions, intervalMs: fix(prefs.sessions.intervalMs) },
    slow: { ...prefs.slow, intervalMs: fix(prefs.slow.intervalMs) },
    replication: { ...prefs.replication, intervalMs: fix(prefs.replication.intervalMs) },
  };
}

export function loadPrefs(connId: string, env: Environment): LiveOpsPrefs {
  const key = `${LIVE_OPS_PREFS_LS_PREFIX}${connId}`;
  const raw = window.localStorage.getItem(key);
  let prefs: LiveOpsPrefs;
  if (raw === null) {
    prefs = defaultsFor(env);
  } else {
    try {
      const parsed = liveOpsPrefsSchema.safeParse(JSON.parse(raw));
      prefs = parsed.success ? parsed.data : defaultsFor(env);
    } catch {
      prefs = defaultsFor(env);
    }
  }
  const corrected = applyEnvCap(prefs, env);
  // Persist back if anything changed (defaults filled or cap-correction).
  if (raw !== JSON.stringify(corrected)) {
    window.localStorage.setItem(key, JSON.stringify(corrected));
  }
  return corrected;
}

export function savePrefs(connId: string, prefs: LiveOpsPrefs): void {
  window.localStorage.setItem(`${LIVE_OPS_PREFS_LS_PREFIX}${connId}`, JSON.stringify(prefs));
}

export function clearPrefs(connId: string): void {
  window.localStorage.removeItem(`${LIVE_OPS_PREFS_LS_PREFIX}${connId}`);
}
