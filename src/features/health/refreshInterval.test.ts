import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Environment } from "../../lib/tauri";
import {
  defaultIntervalFor,
  isCappedFor,
  loadInterval,
  lsKey,
  saveInterval,
} from "./refreshInterval";

const ENVS: readonly Environment[] = ["local", "dev", "stage", "prod"];

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("isCappedFor", () => {
  // 4 environments × 6 intervals = 24 assertions.
  const cases: Array<{ ms: number | null; expected: Record<Environment, boolean> }> = [
    { ms: null, expected: { local: false, dev: false, stage: false, prod: false } },
    { ms: 5_000, expected: { local: false, dev: false, stage: true, prod: true } },
    { ms: 10_000, expected: { local: false, dev: false, stage: false, prod: true } },
    { ms: 30_000, expected: { local: false, dev: false, stage: false, prod: false } },
    { ms: 60_000, expected: { local: false, dev: false, stage: false, prod: false } },
    { ms: 300_000, expected: { local: false, dev: false, stage: false, prod: false } },
  ];

  for (const c of cases) {
    for (const env of ENVS) {
      it(`${env} + ms=${c.ms} → ${c.expected[env]}`, () => {
        expect(isCappedFor(env, c.ms)).toBe(c.expected[env]);
      });
    }
  }
});

describe("defaultIntervalFor", () => {
  // �� Health Screen opens with auto-refresh Off so the user opts in.
  it("prod → null", () => expect(defaultIntervalFor("prod")).toBeNull());
  it("stage → null", () => expect(defaultIntervalFor("stage")).toBeNull());
  it("dev → null", () => expect(defaultIntervalFor("dev")).toBeNull());
  it("local → null", () => expect(defaultIntervalFor("local")).toBeNull());
});

describe("lsKey", () => {
  it("namespaces by connection id", () => {
    expect(lsKey("abc")).toBe("ide99:health.refreshInterval.abc");
  });
});

describe("loadInterval", () => {
  it("returns env default (null = Off) when no LS entry", () => {
    expect(loadInterval("c1", "prod")).toBeNull();
    expect(loadInterval("c1", "stage")).toBeNull();
    expect(loadInterval("c1", "local")).toBeNull();
  });

  it("returns null when LS entry is 'off'", () => {
    window.localStorage.setItem(lsKey("c1"), "off");
    expect(loadInterval("c1", "prod")).toBeNull();
  });

  it("returns parsed ms when within env cap", () => {
    window.localStorage.setItem(lsKey("c1"), "60000");
    expect(loadInterval("c1", "prod")).toBe(60_000);
  });

  it("auto-corrects to Off + overwrites LS when stored value violates env cap", () => {
    window.localStorage.setItem(lsKey("c1"), "5000");
    expect(loadInterval("c1", "prod")).toBeNull();
    expect(window.localStorage.getItem(lsKey("c1"))).toBe("off");
  });

  it("falls back to env default (Off) when LS contains non-finite junk", () => {
    window.localStorage.setItem(lsKey("c1"), "garbage");
    expect(loadInterval("c1", "prod")).toBeNull();
  });
});

describe("saveInterval", () => {
  it("persists 'off' for null", () => {
    saveInterval("c1", null);
    expect(window.localStorage.getItem(lsKey("c1"))).toBe("off");
  });

  it("persists numeric string for ms", () => {
    saveInterval("c1", 30_000);
    expect(window.localStorage.getItem(lsKey("c1"))).toBe("30000");
  });
});
