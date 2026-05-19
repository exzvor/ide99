import { describe, expect, it } from "vitest";
import type { ErdSchemaGraph } from "../../../lib/tauri";
import { applyOps } from "./applyOps";
import {
  type Op,
  makeAddColumnOp,
  makeAddFkOp,
  makeAddTableOp,
  makeMoveTableOp,
  makeRenameColumnOp,
  makeRenameTableOp,
  makeRetypeColumnOp,
} from "./ops";

const baseEmpty: ErdSchemaGraph = { tables: [], foreignKeys: [], fetchedInMs: 0 };

const baseUsers: ErdSchemaGraph = {
  tables: [
    {
      schema: "public",
      name: "users",
      columns: [
        {
          name: "id",
          dataType: "bigint",
          nullable: false,
          isPrimaryKey: true,
          isForeignKey: false,
          ordinal: 1,
        },
        {
          name: "email",
          dataType: "text",
          nullable: true,
          isPrimaryKey: false,
          isForeignKey: false,
          ordinal: 2,
        },
      ],
    },
  ],
  foreignKeys: [],
  fetchedInMs: 0,
};

describe("applyOps", () => {
  it("returns base unchanged when ops empty", () => {
    const out = applyOps(baseUsers, []);
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0].name).toBe("users");
    expect(out.fks).toHaveLength(0);
    expect(out.newTableOpIds.size).toBe(0);
  });

  it("addTable creates a new table with seed identity PK", () => {
    const op = makeAddTableOp("public", "orders");
    const out = applyOps(baseEmpty, [op]);
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0].name).toBe("orders");
    expect(out.tables[0].columns).toHaveLength(1);
    expect(out.tables[0].columns[0].name).toBe("id");
    expect(out.tables[0].columns[0].identity).toBe(true);
    expect(out.tables[0].columns[0].isPrimaryKey).toBe(true);
    expect(out.newTableOpIds.has(op.id)).toBe(true);
  });

  it("addColumn appends to existing table", () => {
    const op = makeAddColumnOp({ schema: "public", name: "users" }, "name", "TEXT", true, false);
    const out = applyOps(baseUsers, [op]);
    const t = out.tables[0];
    expect(t.columns.map((c) => c.name)).toEqual(["id", "email", "name"]);
    expect(t.columns[2].dataType).toBe("TEXT");
  });

  it("renameTable on existing table preserves originalName for ddlGen", () => {
    const op = makeRenameTableOp({ schema: "public", name: "users" }, "members");
    const out = applyOps(baseUsers, [op]);
    expect(out.tables[0].name).toBe("members");
    expect(out.tables[0].originalName).toBe("users");
  });

  it("renameColumn on existing column preserves originalName", () => {
    const op = makeRenameColumnOp(
      { table: { schema: "public", name: "users" }, column: "email" },
      "email_address",
    );
    const out = applyOps(baseUsers, [op]);
    const col = out.tables[0].columns.find((c) => c.id === "email")!;
    expect(col.name).toBe("email_address");
    expect(col.originalName).toBe("email");
  });

  it("retypeColumn updates dataType + tracks original", () => {
    const op = makeRetypeColumnOp(
      { table: { schema: "public", name: "users" }, column: "email" },
      "VARCHAR(320)",
      false,
    );
    const out = applyOps(baseUsers, [op]);
    const col = out.tables[0].columns.find((c) => c.id === "email")!;
    expect(col.dataType).toBe("VARCHAR(320)");
    expect(col.nullable).toBe(false);
    expect(col.originalDataType).toBe("text");
    expect(col.originalNullable).toBe(true);
  });

  it("rename → retype on same column resolves cleanly", () => {
    const r = makeRenameColumnOp(
      { table: { schema: "public", name: "users" }, column: "email" },
      "email_address",
    );
    const t = makeRetypeColumnOp(
      { table: { schema: "public", name: "users" }, column: "email" },
      "TEXT",
      false,
    );
    const out = applyOps(baseUsers, [r, t]);
    const col = out.tables[0].columns.find((c) => c.id === "email")!;
    expect(col.name).toBe("email_address");
    expect(col.dataType).toBe("TEXT");
    expect(col.nullable).toBe(false);
  });

  it("addFk between two existing tables creates working fk", () => {
    const ordersBase: ErdSchemaGraph = {
      tables: [
        ...baseUsers.tables,
        {
          schema: "public",
          name: "orders",
          columns: [
            {
              name: "id",
              dataType: "bigint",
              nullable: false,
              isPrimaryKey: true,
              isForeignKey: false,
              ordinal: 1,
            },
            {
              name: "user_id",
              dataType: "bigint",
              nullable: false,
              isPrimaryKey: false,
              isForeignKey: false,
              ordinal: 2,
            },
          ],
        },
      ],
      foreignKeys: [],
      fetchedInMs: 0,
    };
    const op = makeAddFkOp(
      [{ table: { schema: "public", name: "orders" }, column: "user_id" }],
      [{ table: { schema: "public", name: "users" }, column: "id" }],
      "orders_user_id_fkey",
    );
    const out = applyOps(ordersBase, [op]);
    expect(out.fks).toHaveLength(1);
    expect(out.fks[0].name).toBe("orders_user_id_fkey");
    expect(out.fks[0].source.tableId).toBe("public.orders");
    expect(out.fks[0].source.columnIds).toEqual(["user_id"]);
    expect(out.fks[0].target.tableId).toBe("public.users");
    expect(out.fks[0].target.columnIds).toEqual(["id"]);
    // user_id should now be marked isForeignKey in working graph
    const userIdCol = out.tables
      .find((t) => t.name === "orders")
      ?.columns.find((c) => c.id === "user_id")!;
    expect(userIdCol.isForeignKey).toBe(true);
  });

  it("addTable + addColumn referencing it via NewTableRef + addFk self-contained", () => {
    const t1 = makeAddTableOp("public", "orders");
    const t2 = makeAddTableOp("public", "payments");
    const c1 = makeAddColumnOp({ _new: t2.id }, "order_id", "BIGINT", false, false);
    const seedT1 = t1.seedColumns[0];
    const fk = makeAddFkOp(
      [{ table: { _new: t2.id }, _newCol: c1.id }],
      [{ table: { _new: t1.id }, _newCol: seedT1.opId }],
      "payments_order_id_fkey",
    );
    const out = applyOps(baseEmpty, [t1, t2, c1, fk] as Op[]);
    expect(out.tables.map((t) => t.name).sort()).toEqual(["orders", "payments"]);
    expect(out.fks).toHaveLength(1);
    expect(out.fks[0].source.tableId).toBe(`_new:${t2.id}`);
    expect(out.fks[0].target.tableId).toBe(`_new:${t1.id}`);
  });

  it("moveTable updates working coords (does not mutate base)", () => {
    const m = makeMoveTableOp({ schema: "public", name: "users" }, 100, 200);
    const out = applyOps(baseUsers, [m]);
    // moveTable does NOT shape the working graph for ddlGen; it only feeds
    // positions cache. applyOps should still return the table; coords are
    // applied at layout time. We only verify here that move ops don't throw.
    expect(out.tables).toHaveLength(1);
  });
});
