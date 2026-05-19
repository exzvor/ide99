// src/lib/parser.test.ts
import { describe, expect, it } from "vitest";
import { ddlChangeSchema, queryShapeSchema } from "./parser";

describe("ddlChangeSchema", () => {
  it("validates createTable shape", () => {
    const sample = {
      kind: "createTable",
      schema: "public",
      name: "users",
      columns: [
        {
          name: "id",
          dataType: "bigint",
          nullable: false,
          identity: true,
          isPrimaryKey: true,
        },
      ],
      primaryKey: ["id"],
    };
    expect(() => ddlChangeSchema.parse(sample)).not.toThrow();
  });

  it("rejects unknown kind", () => {
    expect(() => ddlChangeSchema.parse({ kind: "bogus" })).toThrow();
  });
});

describe("queryShapeSchema", () => {
  it("validates a flat shape", () => {
    const sample = {
      baseSelect: { schema: null, table: "users", columns: [] },
      filters: [],
      sort: null,
      limit: null,
      unrepresentableTail: null,
      whereSpan: null,
      orderBySpan: null,
      limitSpan: null,
      fromEnd: 19,
    };
    expect(() => queryShapeSchema.parse(sample)).not.toThrow();
  });
});
