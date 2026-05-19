// — owner: .
//
// Pure unit tests for `buildStatementsQuery`. The builder compiles a
// `pg_stat_statements` selection with a whitelisted ORDER BY column,
// asc/desc direction and a clamped LIMIT.
import { describe, expect, it } from "vitest";

import { type StatementsSortColumn, buildStatementsQuery } from "../statementsQuery";

describe("buildStatementsQuery", () => {
  const cols: StatementsSortColumn[] = [
    "calls",
    "total_exec_time",
    "mean_exec_time",
    "rows",
    "shared_blks_hit",
  ];

  it.each(cols)("emits ASC ORDER BY for sortBy=%s", (sortBy) => {
    const sql = buildStatementsQuery({ topN: 50, sortBy, sortDir: "asc" });
    expect(sql).toContain(`ORDER BY ${sortBy} ASC`);
    expect(sql).toContain("LIMIT 50");
    expect(sql).toContain("FROM pg_stat_statements");
  });

  it.each(cols)("emits DESC ORDER BY for sortBy=%s", (sortBy) => {
    const sql = buildStatementsQuery({ topN: 100, sortBy, sortDir: "desc" });
    expect(sql).toContain(`ORDER BY ${sortBy} DESC`);
    expect(sql).toContain("LIMIT 100");
  });

  it("selects all six expected columns in stable order", () => {
    const sql = buildStatementsQuery({
      topN: 50,
      sortBy: "total_exec_time",
      sortDir: "desc",
    });
    expect(sql).toContain("query,");
    expect(sql).toContain("calls,");
    expect(sql).toContain("total_exec_time,");
    expect(sql).toContain("mean_exec_time,");
    expect(sql).toContain("rows,");
    expect(sql).toContain("shared_blks_hit");
  });

  it("clamps topN to 5000 when input exceeds upper bound", () => {
    const sql = buildStatementsQuery({
      topN: 999_999,
      sortBy: "calls",
      sortDir: "desc",
    });
    expect(sql).toContain("LIMIT 5000");
  });

  it("clamps topN to 1 when input is non-positive", () => {
    const sql = buildStatementsQuery({
      topN: -3,
      sortBy: "calls",
      sortDir: "desc",
    });
    expect(sql).toContain("LIMIT 1");
  });

  it("throws on an invalid sortBy column", () => {
    expect(() =>
      buildStatementsQuery({
        topN: 50,
        // Casting an arbitrary attacker-supplied value; ALLOWED rejects it.
        sortBy: "foo; DROP TABLE users" as unknown as StatementsSortColumn,
        sortDir: "asc",
      }),
).toThrow(/invalid sort column/);
  });
});
