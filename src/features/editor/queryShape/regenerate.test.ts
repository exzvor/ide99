import { describe, expect, it } from "vitest";
import type { QueryShape } from "../../../lib/parser";
import { regenerateSelect } from "./regenerate";

// Spans are 0-based byte offsets [start, end) into the original text.
// "SELECT * FROM users WHERE id = 5"
// 0      7   12   17 19      28 30
// ^start  ^end
// "WHERE id = 5" is bytes 19..31; we use 19..32 (trailing whitespace gobble
// is part of the span if present — the implementation strips trailing space).
const sampleBase: QueryShape = {
  baseSelect: { schema: null, table: "users", columns: [] },
  filters: [],
  sort: null,
  limit: null,
  unrepresentableTail: null,
  whereSpan: { start: 20, end: 32 }, // "WHERE id = 5" without leading space
  orderBySpan: null,
  limitSpan: null,
  fromEnd: 19,
};

describe("regenerateSelect", () => {
  it("removes WHERE when filters empty", () => {
    const original = "SELECT * FROM users WHERE id = 5";
    const out = regenerateSelect(original, { ...sampleBase, filters: [] });
    expect(out.trim()).toBe("SELECT * FROM users");
  });

  it("rewrites WHERE with new equality filter", () => {
    const original = "SELECT * FROM users WHERE id = 5";
    const out = regenerateSelect(original, {
      ...sampleBase,
      filters: [{ column: "name", op: "like", value: "Alice%" }],
    });
    expect(out).toContain("WHERE \"name\" LIKE 'Alice%'");
  });

  it("inserts WHERE when not present", () => {
    const original = "SELECT * FROM users";
    const out = regenerateSelect(original, {
      ...sampleBase,
      whereSpan: null,
      filters: [{ column: "id", op: "gt", value: 10 }],
      fromEnd: 19,
    });
    expect(out).toMatch(/SELECT \* FROM users\s+WHERE/);
    expect(out).toContain('"id" > 10');
  });

  it("preserves text outside of clause spans", () => {
    const original = "SELECT u.* FROM users u WHERE u.id = 1";
    // whereSpan covers "WHERE u.id = 1" → start at index 24
    const out = regenerateSelect(original, {
      ...sampleBase,
      whereSpan: { start: 24, end: 38 },
      filters: [],
      fromEnd: 23,
    });
    expect(out).toContain("SELECT u.* FROM users u");
  });

  it("supports multiple filters joined with AND", () => {
    const original = "SELECT * FROM users WHERE id = 5";
    const out = regenerateSelect(original, {
      ...sampleBase,
      filters: [
        { column: "id", op: "ge", value: 1 },
        { column: "name", op: "ne", value: "bob" },
      ],
    });
    expect(out).toContain('"id" >= 1');
    expect(out).toContain("\"name\" <> 'bob'");
    expect(out).toContain(" AND ");
  });

  it("escapes single quotes in string values", () => {
    const original = "SELECT * FROM users WHERE id = 5";
    const out = regenerateSelect(original, {
      ...sampleBase,
      filters: [{ column: "name", op: "eq", value: "O'Brien" }],
    });
    expect(out).toContain("'O''Brien'");
  });

  it("emits IS NULL / IS NOT NULL without value", () => {
    const original = "SELECT * FROM users WHERE id = 5";
    const out = regenerateSelect(original, {
      ...sampleBase,
      filters: [
        { column: "deleted_at", op: "isNull", value: null },
        { column: "name", op: "isNotNull", value: null },
      ],
    });
    expect(out).toContain('"deleted_at" IS NULL');
    expect(out).toContain('"name" IS NOT NULL');
  });

  it("rewrites ORDER BY when sort changes", () => {
    // "SELECT * FROM users ORDER BY id ASC"
    // ^20            ^35
    const original = "SELECT * FROM users ORDER BY id ASC";
    const out = regenerateSelect(original, {
      ...sampleBase,
      whereSpan: null,
      orderBySpan: { start: 20, end: 35 },
      sort: { column: "name", dir: "desc" },
      fromEnd: 19,
    });
    expect(out).toContain('ORDER BY "name" DESC');
    expect(out).not.toContain("id ASC");
  });

  it("removes ORDER BY when sort cleared", () => {
    const original = "SELECT * FROM users ORDER BY id ASC";
    const out = regenerateSelect(original, {
      ...sampleBase,
      whereSpan: null,
      orderBySpan: { start: 20, end: 35 },
      sort: null,
      fromEnd: 19,
    });
    expect(out.trim()).toBe("SELECT * FROM users");
  });

  it("rewrites LIMIT span", () => {
    // "SELECT * FROM users LIMIT 100"
    // ^20       ^29
    const original = "SELECT * FROM users LIMIT 100";
    const out = regenerateSelect(original, {
      ...sampleBase,
      whereSpan: null,
      limitSpan: { start: 20, end: 29 },
      limit: 50,
      fromEnd: 19,
    });
    expect(out).toContain("LIMIT 50");
    expect(out).not.toContain("LIMIT 100");
  });

  it("removes LIMIT when limit cleared", () => {
    const original = "SELECT * FROM users LIMIT 100";
    const out = regenerateSelect(original, {
      ...sampleBase,
      whereSpan: null,
      limitSpan: { start: 20, end: 29 },
      limit: null,
      fromEnd: 19,
    });
    expect(out.trim()).toBe("SELECT * FROM users");
  });
});
