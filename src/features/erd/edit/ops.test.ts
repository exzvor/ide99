import { describe, expect, it } from "vitest";
import {
  makeAddColumnOp,
  makeAddFkOp,
  makeAddPrimaryKeyOp,
  makeAddTableOp,
  makeDropColumnOp,
  makeDropFkOp,
  makeDropTableOp,
  makeSetColumnNullableOp,
  newOpId,
  opSchema,
} from "./ops";

describe("ops factories + zod", () => {
  it("makeAddTableOp seeds identity PK by default", () => {
    const op = makeAddTableOp("public", "orders");
    expect(op.kind).toBe("addTable");
    expect(op.schema).toBe("public");
    expect(op.name).toBe("orders");
    expect(op.seedColumns).toHaveLength(1);
    const seed = op.seedColumns[0];
    expect(seed.name).toBe("id");
    expect(seed.dataType).toBe("BIGINT");
    expect(seed.identity).toBe(true);
    expect(seed.primaryKey).toBe(true);
    expect(seed.nullable).toBe(false);
    expect(typeof seed.opId).toBe("string");
  });

  it("makeAddTableOp accepts seedColumns override", () => {
    const op = makeAddTableOp("public", "logs", []);
    expect(op.seedColumns).toEqual([]);
  });

  it("makeAddColumnOp builds well-formed op", () => {
    const op = makeAddColumnOp({ schema: "public", name: "users" }, "email", "TEXT", false, false);
    expect(op.kind).toBe("addColumn");
    expect(op.name).toBe("email");
    expect(op.dataType).toBe("TEXT");
    expect(op.nullable).toBe(false);
    expect(op.isPrimaryKey).toBe(false);
  });

  it("zod opSchema round-trips an addTable op", () => {
    const op = makeAddTableOp("public", "orders");
    const json = JSON.parse(JSON.stringify(op));
    const parsed = opSchema.parse(json);
    expect(parsed).toEqual(op);
  });

  it("zod opSchema round-trips an addFk composite op", () => {
    const op = makeAddFkOp(      [
        { table: { schema: "public", name: "orders" }, column: "user_id" },
        { table: { schema: "public", name: "orders" }, column: "tenant_id" },
      ],
      [
        { table: { schema: "public", name: "users" }, column: "id" },
        { table: { schema: "public", name: "users" }, column: "tenant_id" },
      ],
      "orders_user_tenant_fkey",
);
    const parsed = opSchema.parse(JSON.parse(JSON.stringify(op)));
    expect(parsed).toEqual(op);
  });

  it("newOpId returns unique strings", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newOpId()));
    expect(ids.size).toBe(100);
  });

  // S20 — destructive + missing constraint ops
  it("zod opSchema round-trips a dropTable op", () => {
    const op = makeDropTableOp({ schema: "public", name: "users" });
    expect(op.kind).toBe("dropTable");
    expect(opSchema.parse(JSON.parse(JSON.stringify(op)))).toEqual(op);
  });

  it("zod opSchema round-trips a dropColumn op", () => {
    const op = makeDropColumnOp({
      table: { schema: "public", name: "users" },
      column: "deprecated",
    });
    expect(op.kind).toBe("dropColumn");
    expect(opSchema.parse(JSON.parse(JSON.stringify(op)))).toEqual(op);
  });

  it("zod opSchema round-trips a dropFk op", () => {
    const op = makeDropFkOp({ schema: "public", name: "posts" }, "posts_user_fk");
    expect(op.kind).toBe("dropFk");
    expect(opSchema.parse(JSON.parse(JSON.stringify(op)))).toEqual(op);
  });

  it("zod opSchema round-trips a setColumnNullable op", () => {
    const op = makeSetColumnNullableOp(      { table: { schema: "public", name: "users" }, column: "email" },
      false,
);
    expect(op.kind).toBe("setColumnNullable");
    expect(opSchema.parse(JSON.parse(JSON.stringify(op)))).toEqual(op);
  });

  it("zod opSchema round-trips an addPrimaryKey op", () => {
    const op = makeAddPrimaryKeyOp({ schema: "public", name: "users" }, ["id"]);
    expect(op.kind).toBe("addPrimaryKey");
    expect(opSchema.parse(JSON.parse(JSON.stringify(op)))).toEqual(op);
  });

  it("addPrimaryKey requires at least one column", () => {
    expect(() =>
      opSchema.parse({
        kind: "addPrimaryKey",
        id: "x",
        table: { schema: "p", name: "u" },
        columns: [],
      }),
).toThrow();
  });
});
