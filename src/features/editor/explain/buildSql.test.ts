import { describe, expect, it } from "vitest";
import type { ExplainOptions } from "../../../lib/tauri";
import { buildExplainSql } from "./buildSql";

const baseOpts = (over: Partial<ExplainOptions> = {}): ExplainOptions => ({
  mode: "explain",
  verbose: false,
  wal: false,
  timing: false,
  ...over,
});

describe("buildExplainSql", () => {
  it("plain EXPLAIN with minimum options", () => {
    expect(buildExplainSql("SELECT 1", baseOpts())).toBe(      "EXPLAIN (FORMAT JSON, BUFFERS, SETTINGS) SELECT 1",
);
  });

  it("ANALYZE with all toggles", () => {
    expect(      buildExplainSql(        "SELECT 1",
        baseOpts({ mode: "analyze", verbose: true, wal: true, timing: true }),
),
).toBe("EXPLAIN (FORMAT JSON, BUFFERS, SETTINGS, ANALYZE, WAL, TIMING, VERBOSE) SELECT 1");
  });

  it("drops WAL + TIMING when mode != analyze", () => {
    expect(buildExplainSql("SELECT 1", baseOpts({ wal: true, timing: true }))).toBe(      "EXPLAIN (FORMAT JSON, BUFFERS, SETTINGS) SELECT 1",
);
  });

  it("strips trailing semicolon and whitespace", () => {
    expect(buildExplainSql("SELECT 1;\n", baseOpts())).toBe(      "EXPLAIN (FORMAT JSON, BUFFERS, SETTINGS) SELECT 1",
);
  });
});
