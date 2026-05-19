import { describe, expect, it } from "vitest";
import { jsonbDiffSchema, jsonbWriteContextSchema, rowKeySchema } from "./tauri";

describe("S15 jsonb wire schemas", () => {
  it("parses RowKey.pk", () => {
    const v = rowKeySchema.parse({
      kind: "pk",
      schema: "public",
      table: "events",
      columns: [{ name: "id", value: "42", typeName: "int4" }],
    });
    if (v.kind !== "pk") throw new Error("expected pk");
    expect(v.columns[0].name).toBe("id");
  });

  it("parses RowKey.readOnly with reason", () => {
    const v = rowKeySchema.parse({ kind: "readOnly", reason: "viewWithoutPk" });
    if (v.kind !== "readOnly") throw new Error("expected readOnly");
    expect(v.reason).toBe("viewWithoutPk");
  });

  it("rejects RowKey.pk with empty columns", () => {
    expect(() =>
      rowKeySchema.parse({
        kind: "pk",
        schema: "public",
        table: "events",
        columns: [],
      }),
).toThrow();
  });

  it("parses JsonbDiff with set op", () => {
    const v = jsonbDiffSchema.parse({
      ops: [{ kind: "set", path: ["a", "b"], value: 1 }],
      fullReplace: false,
    });
    expect(v.ops).toHaveLength(1);
  });

  it("accepts JsonbWriteContext.confirmedTableName as null", () => {
    const v = jsonbWriteContextSchema.parse({
      connId: "c1",
      rowKey: { kind: "ctid", schema: "public", table: "events", ctid: "(0,5)" },
      column: "data",
      oldValue: "{}",
      newValue: '{"a":1}',
      confirmedTableName: null,
    });
    expect(v.confirmedTableName).toBeNull();
  });

  it("rejects RowKey with unknown kind", () => {
    expect(() => rowKeySchema.parse({ kind: "unknown", x: 1 })).toThrow();
  });
});
