/**
 * —
 *
 * Zustand sub-store for Squawk lint findings. Frontend-only: backend is
 * accessed via Tauri commands inside MigrationsPanel and the store is
 * populated synchronously from those resolves.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useLintStore } from "./lintStore";

describe("lintStore", () => {
  beforeEach(() => useLintStore.setState(useLintStore.getInitialState()));

  it("initial state has empty findings, installed unknown, no rule descriptions", () => {
    const s = useLintStore.getState();
    expect(s.findingsByVersion).toEqual(new Map());
    expect(s.installed).toBe(null);
    expect(s.ruleDescriptions).toEqual(new Map());
  });

  it("setInstalled(true) flips the install flag", () => {
    useLintStore.getState().setInstalled(true, "1.5.0");
    expect(useLintStore.getState().installed).toBe(true);
    expect(useLintStore.getState().version).toBe("1.5.0");
  });

  it("setRuleDescriptions populates the map", () => {
    useLintStore.getState().setRuleDescriptions({ "prefer-text-field": "Use text" });
    expect(useLintStore.getState().ruleDescriptions.get("prefer-text-field")).toBe("Use text");
  });

  it("setFindings(version, []) replaces, not appends", () => {
    useLintStore
      .getState()
      .setFindings("0001", [
        { rule: "a", severity: "warning", file: "f", line: 1, column: 1, message: "" },
      ]);
    useLintStore.getState().setFindings("0001", []);
    expect(useLintStore.getState().findingsByVersion.get("0001")).toEqual([]);
  });

  it("clearAll clears findings but keeps install state and rules", () => {
    useLintStore.getState().setInstalled(true, "1");
    useLintStore.getState().setRuleDescriptions({ a: "b" });
    useLintStore
      .getState()
      .setFindings("0001", [
        { rule: "a", severity: "warning", file: "f", line: 1, column: 1, message: "" },
      ]);
    useLintStore.getState().clearAll();
    expect(useLintStore.getState().findingsByVersion.size).toBe(0);
    expect(useLintStore.getState().installed).toBe(true);
    expect(useLintStore.getState().ruleDescriptions.size).toBe(1);
  });
});
