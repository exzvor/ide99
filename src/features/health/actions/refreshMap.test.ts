import { describe, expect, it } from "vitest";
import { ACTION_REFRESH } from "./refreshMap";

describe("ACTION_REFRESH", () => {
  it("has an entry for every ActionKind including explain", () => {
    expect(Object.keys(ACTION_REFRESH).sort()).toEqual(      ["analyze", "dropIndex", "explain", "killPid", "reindexTable", "vacuum"].sort(),
);
  });

  it("vacuum invalidates vacuum_status and bloat", () => {
    expect([...ACTION_REFRESH.vacuum]).toEqual(["vacuum_status", "bloat"]);
  });

  it("dropIndex invalidates unused_indexes and db_size", () => {
    expect([...ACTION_REFRESH.dropIndex]).toEqual(["unused_indexes", "db_size"]);
  });

  it("killPid invalidates long_running and active_connections", () => {
    expect([...ACTION_REFRESH.killPid]).toEqual(["long_running", "active_connections"]);
  });

  it("explain invalidates nothing", () => {
    expect([...ACTION_REFRESH.explain]).toEqual([]);
  });
});
