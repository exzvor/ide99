import { describe, expect, it } from "vitest";
import { previewSql } from "./previewSql";

describe("previewSql", () => {
  it("formats full replace with PK", () => {
    const sql = previewSql({
      rowKey: {
        kind: "pk",
        schema: "public",
        table: "events",
        columns: [{ name: "id", value: "42", typeName: "int4" }],
      },
      column: "data",
      diff: { ops: [], fullReplace: true, fullValue: { a: 1 } },
    });
    expect(sql).toMatch(/UPDATE "public"."events"/);
    expect(sql).toMatch(/SET "data" = '\{"a":1\}'::jsonb/);
    expect(sql).toMatch(/WHERE "id" = 42/);
  });

  it("formats composed jsonb_set + delete on ctid", () => {
    const sql = previewSql({
      rowKey: { kind: "ctid", schema: "public", table: "t", ctid: "(0,5)" },
      column: "data",
      diff: {
        ops: [
          { kind: "set", path: ["a"], value: "x" },
          { kind: "delete", path: ["b"] },
        ],
        fullReplace: false,
      },
    });
    expect(sql).toMatch(/jsonb_set/);
    expect(sql).toMatch(/#-/);
    expect(sql).toMatch(/WHERE ctid = '\(0,5\)'/);
  });

  it("returns empty string when no changes and not full replace", () => {
    const sql = previewSql({
      rowKey: { kind: "ctid", schema: "public", table: "t", ctid: "(0,5)" },
      column: "data",
      diff: { ops: [], fullReplace: false },
    });
    expect(sql).toBe("");
  });

  it("returns empty string for readOnly row key", () => {
    const sql = previewSql({
      rowKey: { kind: "readOnly", reason: "viewWithoutPk" },
      column: "data",
      diff: { ops: [], fullReplace: true, fullValue: { a: 1 } },
    });
    expect(sql).toBe("");
  });

  it("escapes double-quotes in identifiers", () => {
    const sql = previewSql({
      rowKey: {
        kind: "pk",
        schema: 'we"ird',
        table: 't"bl',
        columns: [{ name: 'i"d', value: "1", typeName: "int4" }],
      },
      column: 'd"ta',
      diff: { ops: [], fullReplace: true, fullValue: null },
    });
    expect(sql).toContain('"we""ird"');
    expect(sql).toContain('"t""bl"');
    expect(sql).toContain('"d""ta"');
    expect(sql).toContain('"i""d"');
  });

  it("uses IS NULL when PK column value is null", () => {
    const sql = previewSql({
      rowKey: {
        kind: "pk",
        schema: "public",
        table: "t",
        columns: [
          { name: "a", value: null, typeName: "int4" },
          { name: "b", value: "5", typeName: "int4" },
        ],
      },
      column: "data",
      diff: { ops: [], fullReplace: true, fullValue: { x: 1 } },
    });
    expect(sql).toMatch(/"a" IS NULL/);
    expect(sql).toMatch(/"b" = 5/);
    expect(sql).toMatch(/AND/);
  });
});
