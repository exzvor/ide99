// â€” env-aware auto-refresh interval helpers.
// implementation per spec Â§6.3.

import type { Environment } from "../../lib/tauri";

export interface RefreshIntervalOption {
  ms: number | null;
  labelKey: string;
}

export const REFRESH_INTERVALS: readonly RefreshIntervalOption[] = [
  { ms: null, labelKey: "health.refresh.off" },
  { ms: 5_000, labelKey: "health.refresh.5s" },
  { ms: 10_000, labelKey: "health.refresh.10s" },
  { ms: 30_000, labelKey: "health.refresh.30s" },
  { ms: 60_000, labelKey: "health.refresh.1m" },
  { ms: 300_000, labelKey: "health.refresh.5m" },
];

/**
 * Returns true if the requested interval (ms) is faster than what's
 * allowed for the connection's environment. `null` (Off) is always
 * allowed; local/dev have no cap.
 */
export function isCappedFor(env: Environment, ms: number | null): boolean {
  if (ms === null) return false;
  if (env === "prod" && ms < 30_000) return true;
  if (env === "stage" && ms < 10_000) return true;
  return false;
}

/**
 * Default polling interval per environment.
 *
 * €” design screen calls for `Off` on first open so the user
 * explicitly opts into polling (no surprise background load on a fresh
 * Health tab, especially on prod). The env-cap below still applies to
 * any subsequent user choice.
 */
export function defaultIntervalFor(_env: Environment): number | null {
  return null;
}

export function lsKey(connectionId: string): string {
  return `ide99:health.refreshInterval.${connectionId}`;
}

/**
 * Read the persisted interval for a connection. Auto-corrects (and
 * overwrites the LS entry) when the stored value is faster than the
 * env-cap permits.
 */
export function loadInterval(connectionId: string, env: Environment): number | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(lsKey(connectionId));
  } catch {
    return defaultIntervalFor(env);
  }
  if (raw === null) return defaultIntervalFor(env);
  if (raw === "off") return null;
  const ms = Number(raw);
  if (!Number.isFinite(ms)) return defaultIntervalFor(env);
  if (isCappedFor(env, ms)) {
    const corrected = defaultIntervalFor(env);
    saveInterval(connectionId, corrected);
    return corrected;
  }
  return ms;
}

/**
 * Persist the user's chosen interval. `null` is stored as the literal
 * string `"off"` (mirrors the load path). Storage exceptions are
 * swallowed â€” the UI doesn't depend on persistence success.
 */
export function saveInterval(connectionId: string, ms: number | null): void {
  try {
    window.localStorage.setItem(lsKey(connectionId), ms === null ? "off" : String(ms));
  } catch {
    // best-effort
  }
}
