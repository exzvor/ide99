// — : tests for the pg_partman registry.
// Strategy: mock `queryExecute` from `lib/tauri` so loadPgPartmanParents can
// run without a real Postgres connection. Asserts:
// * Catalog rows → PartmanMap mapping (schema/table key from "schema.table"
// qualified text, with the rest of the part_config fields preserved).
// * Permission-denied path returns an empty map without throwing and warns
// once.
// * isPartmanParent reads synchronously from the zustand store.
// * invalidatePgPartmanCache clears the connId entry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryExecuteMock = vi.fn();
vi.mock("../../../lib/tauri", () => ({
  queryExecute: (...args: unknown[]) => queryExecuteMock(...args),
}));

import {
  _clearPgPartmanRegistry,
  invalidatePgPartmanCache,
  isPartmanParent,
  loadPgPartmanParents,
} from "../pgPartmanRegistry";
import { usePgPartman } from "../store";

function fakeResult(rows: (string | null)[][]) {
  return {
    columns: [
      { name: "parent_table", typeName: "text", isNumeric: false },
      { name: "control", typeName: "text", isNumeric: false },
      { name: "partition_interval", typeName: "text", isNumeric: false },
      { name: "retention", typeName: "text", isNumeric: false },
      { name: "premake", typeName: "int4", isNumeric: true },
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
  _clearPgPartmanRegistry();
  usePgPartman.setState({ parents: new Map() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPgPartmanParents", () => {
  it("maps part_config rows into a PartmanMap and updates usePgPartman", async () => {
    queryExecuteMock.mockResolvedValueOnce(
      fakeResult([
        ["public.events", "created_at", "1 day", "6 months", "4"],
        ["app.metrics", "ts", "1 hour", null, "8"],
      ]),
    );

    const map = await loadPgPartmanParents("conn-1");

    expect(map.get("public/events")).toEqual({
      schema: "public",
      table: "events",
      controlColumn: "created_at",
      intervalText: "1 day",
      retentionText: "6 months",
      premakeCount: 4,
    });
    expect(map.get("app/metrics")).toEqual({
      schema: "app",
      table: "metrics",
      controlColumn: "ts",
      intervalText: "1 hour",
      retentionText: null,
      premakeCount: 8,
    });

    // Side-effect: store mirrors the same map for connId.
    const stored = usePgPartman.getState().parents.get("conn-1");
    expect(stored?.size).toBe(2);
    expect(stored?.get("public/events")?.controlColumn).toBe("created_at");
  });

  it("splits parent_table on the FIRST dot only", async () => {
    queryExecuteMock.mockResolvedValueOnce(
      fakeResult([["my_schema.my.table", "id", "1 day", null, "4"]]),
    );

    const map = await loadPgPartmanParents("conn-1");
    // First "." separates schema from table; rest stays with table.
    expect(map.get("my_schema/my.table")).toBeDefined();
    expect(map.get("my_schema/my.table")?.schema).toBe("my_schema");
    expect(map.get("my_schema/my.table")?.table).toBe("my.table");
  });

  it("returns an empty map without throwing on permission denied (and warns once)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    queryExecuteMock.mockRejectedValueOnce({
      kind: "postgresError",
      message: "permission denied for schema partman",
    });

    const map = await loadPgPartmanParents("conn-locked");
    expect(map.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);

    // Side-effect still runs: an empty map is stored for the connId so
    // downstream isPartmanParent calls return false reliably.
    const stored = usePgPartman.getState().parents.get("conn-locked");
    expect(stored?.size).toBe(0);

    warn.mockRestore();
  });

  it("re-queries on every call (no in-module memoization beyond usePgPartman)", async () => {
    queryExecuteMock
      .mockResolvedValueOnce(fakeResult([["public.events", "created_at", "1 day", null, "4"]]))
      .mockResolvedValueOnce(fakeResult([["public.events", "created_at", "1 day", null, "4"]]));

    await loadPgPartmanParents("conn-1");
    await loadPgPartmanParents("conn-1");

    expect(queryExecuteMock).toHaveBeenCalledTimes(2);
  });
});

describe("isPartmanParent", () => {
  it("reads synchronously from usePgPartman after a load", async () => {
    queryExecuteMock.mockResolvedValueOnce(
      fakeResult([["public.events", "created_at", "1 day", null, "4"]]),
    );
    await loadPgPartmanParents("conn-1");

    expect(isPartmanParent("conn-1", "public", "events")).toBe(true);
    expect(isPartmanParent("conn-1", "public", "missing")).toBe(false);
    expect(isPartmanParent("unknown-conn", "public", "events")).toBe(false);
  });
});

describe("invalidatePgPartmanCache", () => {
  it("clears the entry for the given connId", async () => {
    queryExecuteMock.mockResolvedValueOnce(
      fakeResult([["public.events", "created_at", "1 day", null, "4"]]),
    );
    await loadPgPartmanParents("conn-1");
    expect(usePgPartman.getState().parents.get("conn-1")?.size).toBeGreaterThan(0);

    invalidatePgPartmanCache("conn-1");
    expect(usePgPartman.getState().parents.get("conn-1")).toBeUndefined();
  });

  it("clears all entries when called without an argument", async () => {
    queryExecuteMock
      .mockResolvedValueOnce(fakeResult([["public.a", "id", "1 day", null, "4"]]))
      .mockResolvedValueOnce(fakeResult([["public.b", "id", "1 day", null, "4"]]));
    await loadPgPartmanParents("conn-a");
    await loadPgPartmanParents("conn-b");
    expect(usePgPartman.getState().parents.size).toBe(2);

    invalidatePgPartmanCache();
    expect(usePgPartman.getState().parents.size).toBe(0);
  });
});
