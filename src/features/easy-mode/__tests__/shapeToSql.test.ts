import { describe, expect, it } from "vitest";
import type { QueryShape } from "../../../lib/parser";
import { shapeToSql, whereSignature } from "../shapeToSql";

function shape(overrides: Partial<QueryShape> = {}): QueryShape {
  return {
    baseSelect: { schema: null, table: "users", columns: ["*"] },
    filters: [],
    sort: null,
    limit: null,
    unrepresentableTail: null,
    whereSpan: null,
    orderBySpan: null,
    limitSpan: null,
    fromEnd: 0,
    ...overrides,
  };
}

describe("shapeToSql", () => {
  it("renders SELECT * FROM users", () => {
    expect(shapeToSql(shape())).toBe(`SELECT *\nFROM "users"`);
  });

  it("qualifies the table with its schema when present", () => {
    expect(
      shapeToSql(shape({ baseSelect: { schema: "app", table: "users", columns: ["*"] } })),
    ).toBe(`SELECT *\nFROM "app"."users"`);
  });

  it("renders explicit columns with double-quotes", () => {
    const sql = shapeToSql(
      shape({ baseSelect: { schema: null, table: "users", columns: ["id", "email"] } }),
    );
    expect(sql).toBe(`SELECT "id", "email"\nFROM "users"`);
  });

  it("renders WHERE / ORDER BY / LIMIT", () => {
    const sql = shapeToSql(
      shape({
        filters: [{ column: "status", op: "eq", value: "active" }],
        sort: { column: "created_at", dir: "desc" },
        limit: 50,
      }),
    );
    expect(sql).toBe(
      [
        "SELECT *",
        `FROM "users"`,
        `WHERE "status" = 'active'`,
        `ORDER BY "created_at" DESC`,
        "LIMIT 50",
      ].join("\n"),
    );
  });

  it("AND-chains multiple filters", () => {
    const sql = shapeToSql(
      shape({
        filters: [
          { column: "status", op: "eq", value: "active" },
          { column: "age", op: "gt", value: 18 },
          { column: "deleted_at", op: "isNull" },
        ],
      }),
    );
    expect(sql).toContain(`WHERE "status" = 'active'`);
    expect(sql).toContain(`  AND "age" > 18`);
    expect(sql).toContain(`  AND "deleted_at" IS NULL`);
  });

  it("escapes single quotes in string values", () => {
    const sql = shapeToSql(shape({ filters: [{ column: "name", op: "eq", value: "O'Brien" }] }));
    expect(sql).toContain(`"name" = 'O''Brien'`);
  });
});

describe("whereSignature", () => {
  it("returns empty string for null shape", () => {
    expect(whereSignature(null)).toBe("");
  });

  it("returns empty string when no filters", () => {
    expect(whereSignature(shape())).toBe("");
  });

  it("differs when WHERE filters change", () => {
    const a = whereSignature(shape({ filters: [{ column: "id", op: "eq", value: 1 }] }));
    const b = whereSignature(shape({ filters: [{ column: "id", op: "eq", value: 2 }] }));
    expect(a).not.toBe(b);
  });
});
