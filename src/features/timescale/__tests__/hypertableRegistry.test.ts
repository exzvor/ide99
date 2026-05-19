// — : tests for the hypertable registry.
// Strategy: mock `queryExecute` from the `lib/tauri` module so loadHypertables
// can be exercised without a real Postgres connection. Asserts:
// * The catalog row → HypertableMap mapping (with CA public-view alias).
// * Permission-denied path returns an empty map without throwing.
// * invalidateHypertableCache clears the connId entry from useTimescale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryExecuteMock = vi.fn();
vi.mock("../../../lib/tauri", () => ({
  queryExecute: (...args: unknown[]) => queryExecuteMock(...args),
}));

import {
  _clearHypertableRegistry,
  invalidateHypertableCache,
  isContinuousAggregate,
  isHypertable,
  loadHypertables,
} from "../hypertableRegistry";
import { useTimescale } from "../store";

function fakeResult(rows: (string | null)[][]) {
  return {
    columns: [
      { name: "schema_name", typeName: "name", isNumeric: false },
      { name: "table_name", typeName: "name", isNumeric: false },
      { name: "is_continuous_aggregate", typeName: "bool", isNumeric: false },
      { name: "view_schema", typeName: "name", isNumeric: false },
      { name: "view_name", typeName: "name", isNumeric: false },
    ],
    rows,
    truncated: false,
    durationMs: 1,
    affectedRows: null,
    statusMessage: "ok",
  };
}

beforeEach(() => {
  queryExecuteMock.mockReset();
  _clearHypertableRegistry();
  useTimescale.setState({ hypertables: new Map() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadHypertables", () => {
  it("maps catalog rows into a HypertableMap and updates useTimescale", async () => {
    queryExecuteMock.mockResolvedValueOnce(
      fakeResult([
        // Plain hypertable.
        ["public", "metrics", "f", null, null],
        // Continuous aggregate (materialization hypertable + CA public view).
        ["_timescaledb_internal", "_materialized_hypertable_1", "t", "public", "hourly_metrics"],
        // Another regular hypertable.
        ["analytics", "events", "f", null, null],
      ]),
    );

    const map = await loadHypertables("conn-1");

    expect(map.get("public/metrics")).toEqual({
      isHypertable: true,
      isContinuousAggregate: false,
    });
    expect(map.get("analytics/events")).toEqual({
      isHypertable: true,
      isContinuousAggregate: false,
    });
    // Continuous aggregate's underlying materialization hypertable.
    expect(map.get("_timescaledb_internal/_materialized_hypertable_1")).toEqual({
      isHypertable: true,
      isContinuousAggregate: true,
    });
    // CA's public-view alias — what users actually look for in SchemaTree.
    expect(map.get("public/hourly_metrics")).toEqual({
      isHypertable: true,
      isContinuousAggregate: true,
    });

    // Side-effect: useTimescale store mirrors the same map for connId.
    const stored = useTimescale.getState().hypertables.get("conn-1");
    expect(stored?.get("public/metrics")).toEqual({
      isHypertable: true,
      isContinuousAggregate: false,
    });
    expect(stored?.get("public/hourly_metrics")).toEqual({
      isHypertable: true,
      isContinuousAggregate: true,
    });
  });

  it("returns an empty map without throwing on permission denied", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    queryExecuteMock.mockRejectedValueOnce({
      kind: "postgresError",
      message: "permission denied for schema _timescaledb_catalog",
    });

    const map = await loadHypertables("conn-locked");
    expect(map.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("re-queries on every call (no in-module memoization beyond useTimescale)", async () => {
    queryExecuteMock
      .mockResolvedValueOnce(fakeResult([["public", "metrics", "f", null, null]]))
      .mockResolvedValueOnce(fakeResult([["public", "metrics", "f", null, null]]));

    await loadHypertables("conn-1");
    await loadHypertables("conn-1");

    expect(queryExecuteMock).toHaveBeenCalledTimes(2);
  });
});

describe("isHypertable / isContinuousAggregate", () => {
  it("synchronously reads the useTimescale store and returns boolean flags", async () => {
    queryExecuteMock.mockResolvedValueOnce(
      fakeResult([
        ["public", "metrics", "f", null, null],
        ["_timescaledb_internal", "_materialized_hypertable_1", "t", "public", "hourly"],
      ]),
    );
    await loadHypertables("conn-1");

    expect(isHypertable("conn-1", "public", "metrics")).toBe(true);
    expect(isHypertable("conn-1", "public", "hourly")).toBe(true);
    expect(isHypertable("conn-1", "public", "missing")).toBe(false);

    expect(isContinuousAggregate("conn-1", "public", "metrics")).toBe(false);
    expect(isContinuousAggregate("conn-1", "public", "hourly")).toBe(true);
    expect(isContinuousAggregate("conn-1", "public", "missing")).toBe(false);
  });

  it("returns false when no entry exists for the connId yet", () => {
    expect(isHypertable("unknown-conn", "public", "metrics")).toBe(false);
    expect(isContinuousAggregate("unknown-conn", "public", "metrics")).toBe(false);
  });
});

describe("invalidateHypertableCache", () => {
  it("clears the entry for the given connId in useTimescale", async () => {
    queryExecuteMock.mockResolvedValueOnce(fakeResult([["public", "metrics", "f", null, null]]));
    await loadHypertables("conn-1");
    expect(useTimescale.getState().hypertables.get("conn-1")?.size).toBeGreaterThan(0);

    invalidateHypertableCache("conn-1");
    expect(useTimescale.getState().hypertables.get("conn-1")).toBeUndefined();
  });

  it("clears every connId when called without an argument", async () => {
    queryExecuteMock
      .mockResolvedValueOnce(fakeResult([["public", "a", "f", null, null]]))
      .mockResolvedValueOnce(fakeResult([["public", "b", "f", null, null]]));
    await loadHypertables("conn-a");
    await loadHypertables("conn-b");
    expect(useTimescale.getState().hypertables.size).toBe(2);

    invalidateHypertableCache();
    expect(useTimescale.getState().hypertables.size).toBe(0);
  });
});
