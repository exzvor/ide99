/**
 * — Easy linter rule matchers.
 *
 * Each rule has a positive (should fire) + negative (should NOT fire)
 * test plus a coordinate sanity test for at least one rule.
 */

import { describe, expect, it } from "vitest";
import { lintSql, offsetToLineCol } from "../lint";

function ids(text: string): string[] {
  return lintSql(text).map((f) => f.ruleId);
}

describe("offsetToLineCol", () => {
  it("returns 1-based coords", () => {
    expect(offsetToLineCol("abc", 0)).toEqual({ line: 1, col: 1 });
    expect(offsetToLineCol("abc", 2)).toEqual({ line: 1, col: 3 });
  });
  it("counts newlines", () => {
    expect(offsetToLineCol("abc\nde", 4)).toEqual({ line: 2, col: 1 });
    expect(offsetToLineCol("abc\nde", 5)).toEqual({ line: 2, col: 2 });
  });
});

describe("rule: where_eq_null", () => {
  it("flags = NULL", () => {
    expect(ids("SELECT 1 WHERE col = NULL")).toContain("where_eq_null");
  });
  it("flags <> NULL", () => {
    expect(ids("SELECT 1 WHERE col <> NULL")).toContain("where_eq_null");
  });
  it("flags != NULL", () => {
    expect(ids("SELECT 1 WHERE col != NULL")).toContain("where_eq_null");
  });
  it("does NOT flag IS NULL", () => {
    expect(ids("SELECT 1 WHERE col IS NULL")).not.toContain("where_eq_null");
  });
});

describe("rule: select_distinct_star", () => {
  it("flags SELECT DISTINCT *", () => {
    expect(ids("SELECT DISTINCT * FROM t")).toContain("select_distinct_star");
  });
  it("does NOT flag SELECT DISTINCT col", () => {
    expect(ids("SELECT DISTINCT col FROM t")).not.toContain("select_distinct_star");
  });
});

describe("rule: order_by_index", () => {
  it("flags ORDER BY 1", () => {
    expect(ids("SELECT a, b FROM t ORDER BY 1")).toContain("order_by_index");
  });
  it("flags ORDER BY 1, 2", () => {
    expect(ids("SELECT a, b FROM t ORDER BY 1, 2")).toContain("order_by_index");
  });
  it("does NOT flag ORDER BY name", () => {
    expect(ids("SELECT a FROM t ORDER BY a")).not.toContain("order_by_index");
  });
});

describe("rule: limit_without_order", () => {
  it("flags LIMIT without preceding ORDER BY", () => {
    expect(ids("SELECT * FROM t LIMIT 10")).toContain("limit_without_order");
  });
  it("does NOT flag LIMIT after ORDER BY", () => {
    expect(ids("SELECT * FROM t ORDER BY id LIMIT 10")).not.toContain("limit_without_order");
  });
});

describe("rule: like_no_wildcard", () => {
  it("flags LIKE 'plain'", () => {
    expect(ids("SELECT 1 WHERE x LIKE 'plain'")).toContain("like_no_wildcard");
  });
  it("does NOT flag LIKE '%foo%'", () => {
    expect(ids("SELECT 1 WHERE x LIKE '%foo%'")).not.toContain("like_no_wildcard");
  });
  it("does NOT flag LIKE '_oo'", () => {
    expect(ids("SELECT 1 WHERE x LIKE '_oo'")).not.toContain("like_no_wildcard");
  });
});

describe("rule: update_no_where", () => {
  it("flags UPDATE t SET ... without WHERE", () => {
    expect(ids("UPDATE t SET col = 1")).toContain("update_no_where");
  });
  it("does NOT flag UPDATE with WHERE", () => {
    expect(ids("UPDATE t SET col = 1 WHERE id = 5")).not.toContain("update_no_where");
  });
});

describe("rule: delete_no_where", () => {
  it("flags DELETE FROM t (no WHERE)", () => {
    expect(ids("DELETE FROM t")).toContain("delete_no_where");
  });
  it("does NOT flag DELETE with WHERE", () => {
    expect(ids("DELETE FROM t WHERE id = 5")).not.toContain("delete_no_where");
  });
});

describe("rule: cross_join_implicit", () => {
  it("flags FROM a, b without WHERE", () => {
    expect(ids("SELECT * FROM a, b")).toContain("cross_join_implicit");
  });
  it("does NOT flag explicit JOIN", () => {
    expect(ids("SELECT * FROM a JOIN b ON a.id = b.id")).not.toContain("cross_join_implicit");
  });
  it("does NOT flag comma-list with WHERE", () => {
    expect(ids("SELECT * FROM a, b WHERE a.id = b.id")).not.toContain("cross_join_implicit");
  });
});

describe("rule: count_star_distinct", () => {
  it("flags COUNT(*) under GROUP BY", () => {
    expect(ids("SELECT k, COUNT(*) FROM t GROUP BY k")).toContain("count_star_distinct");
  });
  it("does NOT flag COUNT(*) without GROUP BY", () => {
    expect(ids("SELECT COUNT(*) FROM t")).not.toContain("count_star_distinct");
  });
});

describe("rule: unqualified_drop", () => {
  it("flags DROP TABLE name", () => {
    expect(ids("DROP TABLE my_table")).toContain("unqualified_drop");
  });
  it("does NOT flag DROP TABLE schema.name", () => {
    expect(ids("DROP TABLE public.my_table")).not.toContain("unqualified_drop");
  });
});

describe("rule: bool_not_eq", () => {
  it("flags = true", () => {
    expect(ids("SELECT 1 WHERE flag = true")).toContain("bool_not_eq");
  });
  it("flags <> false", () => {
    expect(ids("SELECT 1 WHERE flag <> false")).toContain("bool_not_eq");
  });
  it("does NOT flag column predicate alone", () => {
    expect(ids("SELECT 1 WHERE flag")).not.toContain("bool_not_eq");
  });
});

describe("rule: type_cast_double_colon_spaces", () => {
  it("flags `x :: int`", () => {
    expect(ids("SELECT x :: int FROM t")).toContain("type_cast_double_colon_spaces");
  });
  it("does NOT flag tight `x::int`", () => {
    expect(ids("SELECT x::int FROM t")).not.toContain("type_cast_double_colon_spaces");
  });
});

describe("multi-rule", () => {
  it("emits multiple findings for a multi-bug query", () => {
    const found = ids("UPDATE t SET col = NULL WHERE other = NULL");
    // UPDATE has WHERE (so update_no_where shouldn't fire) — but where_eq_null should.
    expect(found).toContain("where_eq_null");
    expect(found).not.toContain("update_no_where");
  });
  it("emits two findings for two distinct mistakes", () => {
    const found = ids("SELECT * FROM t LIMIT 10;\nSELECT DISTINCT * FROM t");
    expect(found).toContain("limit_without_order");
    expect(found).toContain("select_distinct_star");
  });
});

describe("coordinate sanity", () => {
  it("returns 1-based line/col for findings on line 2", () => {
    const text = "SELECT 1;\nDELETE FROM t";
    const finding = lintSql(text).find((f) => f.ruleId === "delete_no_where");
    expect(finding).toBeDefined();
    expect(finding?.line).toBe(2);
    expect(finding?.col).toBe(1);
  });
});

describe("known limitations", () => {
  // These are documented as acceptable false-positives for v1 (regex linter,
  // not a SQL parser). The tests *assert* the limitation so anyone who later
  // upgrades to a real parser knows which tests to re-evaluate.
  it("false-positives inside string literals (documented)", () => {
    expect(ids("SELECT 'WHERE col = NULL'")).toContain("where_eq_null");
  });
});
