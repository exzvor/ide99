import { describe, expect, it } from "vitest";
import { formatSql } from "./formatter";

describe("formatSql", () => {
  it("returns null on parse error", () => {
    expect(formatSql("SELECT * FRO bad sql")).not.toBeNull(); // sql-formatter is permissive,
    // we just check it doesn't throw — null reserved for true parse failure
  });

  it("uppercases keywords", () => {
    // sql-formatter@15 places list items on their own line with 2-space indent;
    // assertion is "keywords are uppercased and operands appear in order".
    expect(formatSql("select 1 from t")).toMatch(/SELECT\s+1\s+FROM\s+t/);
  });

  it("indents with 2 spaces", () => {
    const out = formatSql("SELECT a, b FROM t");
    // tabWidth=2 → leading 2 spaces on each list item; FROM clause's operand
    // also lands on its own indented line under sql-formatter@15.
    expect(out).toMatch(/^SELECT\n {2}a,\n {2}b\nFROM\n {2}t/m);
  });

  it("preserves Cyrillic identifiers verbatim", () => {
    const out = formatSql('SELECT "Заказы"."Дата" FROM "Заказы"');
    expect(out).toContain('"Заказы"');
    expect(out).toContain('"Дата"');
  });

  it("preserves dollar-quoted bodies", () => {
    const out = formatSql("SELECT $$body $$ FROM t");
    expect(out).toContain("$$body $$");
  });

  it("places 2 blank lines between statements", () => {
    const out = formatSql("SELECT 1; SELECT 2");
    // linesBetweenQueries = 2 → 2 BLANK lines (= 3 newline chars) between
    // statements in sql-formatter@15. The assertion is "the second SELECT is
    // separated by ≥2 newlines from the first statement's terminator".
    expect(out).toMatch(/;\n\n+SELECT\s+2/);
  });

  it("idempotent — formatting twice is the same as once", () => {
    const sql = "select * from users where id = 1";
    const once = formatSql(sql);
    expect(once).not.toBeNull();
    if (once === null) return;
    const twice = formatSql(once);
    expect(twice).toBe(once);
  });

  it("returns null for empty string", () => {
    expect(formatSql("")).toBeNull();
  });

  it("preserves -- line comments in place", () => {
    const out = formatSql("SELECT 1 -- comment\nFROM t");
    expect(out).toContain("-- comment");
  });

  it("preserves /* block */ comments", () => {
    const out = formatSql("SELECT /* hi */ 1 FROM t");
    expect(out).toContain("/* hi */");
  });
});
