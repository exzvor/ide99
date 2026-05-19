import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LIVE_OPS_PREFS_LS_PREFIX,
  LIVE_OPS_PREFS_SCHEMA_VERSION,
  clearPrefs,
  loadPrefs,
  savePrefs,
} from "./prefs";

describe("live-ops prefs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("loads defaults for local env when nothing persisted", () => {
    const p = loadPrefs("c1", "local");
    expect(p.schemaVersion).toBe(LIVE_OPS_PREFS_SCHEMA_VERSION);
    expect(p.activeSubTab).toBe("sessions");
    expect(p.sessions.intervalMs).toBe(2000);
    expect(p.slow.intervalMs).toBe(5000);
    expect(p.replication.intervalMs).toBe(5000);
  });

  it("save+load roundtrip preserves user choices", () => {
    const p = loadPrefs("c1", "local");
    p.sessions.mode = "all";
    p.slow.sortBy = "calls";
    savePrefs("c1", p);
    const reloaded = loadPrefs("c1", "local");
    expect(reloaded.sessions.mode).toBe("all");
    expect(reloaded.slow.sortBy).toBe("calls");
  });

  it("schema-version mismatch resets to defaults", () => {
    window.localStorage.setItem(      `${LIVE_OPS_PREFS_LS_PREFIX}c1`,
      JSON.stringify({ schemaVersion: 999, activeSubTab: "sessions" }),
);
    const p = loadPrefs("c1", "local");
    expect(p.schemaVersion).toBe(LIVE_OPS_PREFS_SCHEMA_VERSION);
    expect(p.activeSubTab).toBe("sessions");
  });

  it("env-cap auto-corrects 1s on prod to 2s minimum", () => {
    const stale = {
      schemaVersion: 1,
      activeSubTab: "sessions",
      sessions: { mode: "blocked", intervalMs: 1000 },
      slow: { sortBy: "meanExecTime", intervalMs: 1000 },
      replication: { showEmpty: false, intervalMs: 1000 },
    };
    window.localStorage.setItem(`${LIVE_OPS_PREFS_LS_PREFIX}c1`, JSON.stringify(stale));
    const p = loadPrefs("c1", "prod");
    expect(p.sessions.intervalMs).toBeGreaterThanOrEqual(2000);
    expect(p.slow.intervalMs).toBeGreaterThanOrEqual(2000);
    expect(p.replication.intervalMs).toBeGreaterThanOrEqual(2000);
  });

  it("clearPrefs removes the LS entry", () => {
    savePrefs("c1", loadPrefs("c1", "local"));
    expect(window.localStorage.getItem(`${LIVE_OPS_PREFS_LS_PREFIX}c1`)).not.toBeNull();
    clearPrefs("c1");
    expect(window.localStorage.getItem(`${LIVE_OPS_PREFS_LS_PREFIX}c1`)).toBeNull();
  });
});
