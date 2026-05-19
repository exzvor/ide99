import { describe, expect, it } from "vitest";
import { analyzeForEasyAdvisory, analyzeStatement } from "./analyzer";

interface Fixture {
  name: string;
  sql: string;
  expect: ReturnType<typeof analyzeStatement>;
}

const fixtures: Fixture[] = [
  // safe — SELECT-class
  { name: "plain SELECT", sql: "SELECT * FROM users", expect: { kind: "safe", isReadHeavy: true } },
  {
    name: "WITH-then-SELECT",
    sql: "WITH x AS (SELECT 1) SELECT * FROM x",
    expect: { kind: "safe", isReadHeavy: true },
  },
  { name: "INSERT", sql: "INSERT INTO foo VALUES (1)", expect: { kind: "safe" } },
  { name: "UPDATE WITH WHERE", sql: "UPDATE foo SET a=1 WHERE id=2", expect: { kind: "safe" } },
  { name: "DELETE WITH WHERE", sql: "DELETE FROM foo WHERE id=2", expect: { kind: "safe" } },
  // destructive
  {
    name: "DROP TABLE",
    sql: "DROP TABLE users",
    expect: { kind: "destructive", action: "drop", target: "users" },
  },
  {
    name: "DROP TABLE IF EXISTS",
    sql: "DROP TABLE IF EXISTS foo",
    expect: { kind: "destructive", action: "drop", target: "foo" },
  },
  {
    name: "DROP SCHEMA",
    sql: "DROP SCHEMA public CASCADE",
    expect: { kind: "destructive", action: "drop", target: "public" },
  },
  {
    name: "DROP DATABASE",
    sql: "DROP DATABASE prod",
    expect: { kind: "destructive", action: "drop", target: "prod" },
  },
  {
    name: "DROP INDEX",
    sql: "DROP INDEX idx_users",
    expect: { kind: "destructive", action: "drop", target: "idx_users" },
  },
  {
    name: "DROP VIEW",
    sql: "DROP VIEW v_users",
    expect: { kind: "destructive", action: "drop", target: "v_users" },
  },
  {
    name: "DROP MATERIALIZED VIEW",
    sql: "DROP MATERIALIZED VIEW mv_users",
    expect: { kind: "destructive", action: "drop", target: "mv_users" },
  },
  {
    name: "DROP FUNCTION",
    sql: "DROP FUNCTION my_fn()",
    expect: { kind: "destructive", action: "drop", target: "my_fn" },
  },
  {
    name: "DROP TRIGGER",
    sql: "DROP TRIGGER tr_users ON users",
    expect: { kind: "destructive", action: "drop", target: "tr_users" },
  },
  {
    name: "TRUNCATE TABLE",
    sql: "TRUNCATE TABLE foo",
    expect: { kind: "destructive", action: "truncate", target: "foo" },
  },
  {
    name: "TRUNCATE without TABLE keyword",
    sql: "TRUNCATE foo",
    expect: { kind: "destructive", action: "truncate", target: "foo" },
  },
  {
    name: "TRUNCATE with CASCADE",
    sql: "TRUNCATE TABLE foo RESTART IDENTITY CASCADE",
    expect: { kind: "destructive", action: "truncate", target: "foo" },
  },
  {
    name: "DELETE NO WHERE",
    sql: "DELETE FROM foo",
    expect: { kind: "destructive", action: "delete-all", target: "delete-all" },
  },
  {
    name: "DELETE NO WHERE with semicolon",
    sql: "DELETE FROM foo;",
    expect: { kind: "destructive", action: "delete-all", target: "delete-all" },
  },
  {
    name: "UPDATE NO WHERE",
    sql: "UPDATE foo SET a=1",
    expect: { kind: "destructive", action: "update-all", target: "update-all" },
  },
  // false-positive guards
  {
    name: "DROP inside string literal",
    sql: "SELECT 'DROP TABLE foo'",
    expect: { kind: "safe", isReadHeavy: true },
  },
  {
    name: "DROP inside line comment",
    sql: "SELECT 1 -- DROP TABLE foo\nFROM t",
    expect: { kind: "safe", isReadHeavy: true },
  },
  {
    name: "DROP inside dollar-quoted body",
    sql: "SELECT $$body DROP TABLE foo $$",
    expect: { kind: "safe", isReadHeavy: true },
  },
  {
    name: "multi-statement; trailing destructive wins",
    sql: "SELECT 1; DROP TABLE foo",
    expect: { kind: "destructive", action: "drop", target: "foo" },
  },
  {
    name: "CREATE TABLE is safe (creation, not destruction)",
    sql: "CREATE TABLE foo (id BIGSERIAL)",
    expect: { kind: "safe" },
  },
];

describe("analyzeStatement", () => {
  for (const fx of fixtures) {
    it(fx.name, () => {
      const got = analyzeStatement(fx.sql);
      // Compare key fields; fixture intentionally omits unset fields
      if (fx.expect.kind !== undefined) expect(got.kind).toBe(fx.expect.kind);
      if (fx.expect.action !== undefined) expect(got.action).toBe(fx.expect.action);
      if (fx.expect.target !== undefined) expect(got.target).toBe(fx.expect.target);
      if (fx.expect.isReadHeavy !== undefined) expect(got.isReadHeavy).toBe(fx.expect.isReadHeavy);
    });
  }
});

describe("analyzeForEasyAdvisory — cross-join", () => {
  it("flags FROM a, b without WHERE", () => {
    const got = analyzeForEasyAdvisory("SELECT a.id FROM users a, orders b");
    expect(got).toEqual({ kind: "cross-join", tableCount: 2 });
  });
  it("counts three comma-separated tables", () => {
    const got = analyzeForEasyAdvisory("SELECT * FROM a, b, c");
    expect(got?.kind).toBe("cross-join");
    if (got?.kind === "cross-join") expect(got.tableCount).toBe(3);
  });
  it("does not flag explicit CROSS JOIN", () => {
    const got = analyzeForEasyAdvisory("SELECT * FROM a CROSS JOIN b");
    expect(got).toBeNull();
  });
  it("does not flag implicit join when WHERE links them", () => {
    const got = analyzeForEasyAdvisory("SELECT * FROM users a, orders b WHERE a.id = b.user_id");
    expect(got).toBeNull();
  });
  it("does not flag a single FROM table", () => {
    const got = analyzeForEasyAdvisory("SELECT * FROM users WHERE id = 1");
    expect(got).toBeNull();
  });
  it("does not flag commas inside subqueries", () => {
    // Comma is depth>0, not a top-level FROM separator.
    const got = analyzeForEasyAdvisory(
      "SELECT (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id) FROM users u WHERE u.id = 1",
    );
    expect(got).toBeNull();
  });
});

describe("analyzeForEasyAdvisory — slow-preview", () => {
  it("flags SELECT * FROM big_table", () => {
    const got = analyzeForEasyAdvisory("SELECT * FROM big_table");
    expect(got).toEqual({ kind: "slow-preview" });
  });
  it("does not flag when LIMIT is present", () => {
    const got = analyzeForEasyAdvisory("SELECT * FROM big_table LIMIT 100");
    expect(got).toBeNull();
  });
  it("does not flag when WHERE is present", () => {
    const got = analyzeForEasyAdvisory("SELECT * FROM big_table WHERE id = 1");
    expect(got).toBeNull();
  });
  it("does not flag a column projection", () => {
    const got = analyzeForEasyAdvisory("SELECT id FROM big_table");
    expect(got).toBeNull();
  });
  it("does not flag JOINed SELECT *", () => {
    const got = analyzeForEasyAdvisory("SELECT * FROM a INNER JOIN b ON a.id = b.aid");
    expect(got).toBeNull();
  });
  it("does not flag non-SELECT statements", () => {
    expect(analyzeForEasyAdvisory("INSERT INTO foo VALUES (1)")).toBeNull();
    expect(analyzeForEasyAdvisory("DELETE FROM foo WHERE id = 1")).toBeNull();
  });
  it("returns cross-join in preference to slow-preview when both apply", () => {
    // SELECT * FROM a, b qualifies for both; cross-join takes priority.
    const got = analyzeForEasyAdvisory("SELECT * FROM a, b");
    expect(got?.kind).toBe("cross-join");
  });
  it("returns null on empty input", () => {
    expect(analyzeForEasyAdvisory("")).toBeNull();
    expect(analyzeForEasyAdvisory("   \n  ")).toBeNull();
  });
});
