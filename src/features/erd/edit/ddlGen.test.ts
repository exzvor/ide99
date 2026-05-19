import { describe, expect, it } from "vitest";
import type { ErdSchemaGraph } from "../../../lib/tauri";
import { generateDdl } from "./ddlGen";
import {
  makeAddColumnOp,
  makeAddFkOp,
  makeAddPrimaryKeyOp,
  makeAddTableOp,
  makeDropColumnOp,
  makeDropFkOp,
  makeDropTableOp,
  makeRenameColumnOp,
  makeRenameTableOp,
  makeRetypeColumnOp,
  makeSetColumnNullableOp,
} from "./ops";

const empty: ErdSchemaGraph = { tables: [], foreignKeys: [], fetchedInMs: 0 };

const usersOrders: ErdSchemaGraph = {
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
      ],
    },
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

describe("generateDdl", () => {
  it("empty op-log produces empty SQL", () => {
    const out = generateDdl(empty, []);
    expect(out.sql).toBe("");
    expect(out.statements).toEqual([]);
  });

  it("CREATE TABLE coalesces seed + addColumn + self-contained FK (Spec §5.4 Example 1)", () => {
    const t1 = makeAddTableOp("public", "orders");
    const c1 = makeAddColumnOp({ _new: t1.id }, "user_id", "BIGINT", false, false);
    const t2 = makeAddTableOp("public", "payments");
    const c2 = makeAddColumnOp({ _new: t2.id }, "order_id", "BIGINT", false, false);
    const t1seed = t1.seedColumns[0];
    const fk = makeAddFkOp(
      [{ table: { _new: t2.id }, _newCol: c2.id }],
      [{ table: { _new: t1.id }, _newCol: t1seed.opId }],
      "payments_order_id_fkey",
    );
    const out = generateDdl(empty, [t1, c1, t2, c2, fk]);
    expect(out.sql).toContain('CREATE TABLE "public"."orders"');
    expect(out.sql).toContain('"id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
    expect(out.sql).toContain('"user_id" BIGINT NOT NULL');
    expect(out.sql).toContain('CREATE TABLE "public"."payments"');
    expect(out.sql).toContain('"order_id" BIGINT NOT NULL');
    expect(out.sql).toContain(
      'CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders" ("id")',
    );
    // Self-contained FK lives inline in CREATE TABLE, not as separate ALTER.
    expect(out.sql).not.toContain('ALTER TABLE "public"."payments" ADD CONSTRAINT');
  });

  it("Add column + rename + FK to existing table (Spec §5.4 Example 2)", () => {
    const c1 = makeAddColumnOp({ schema: "public", name: "users" }, "email", "TEXT", false, false);
    const r1 = makeRenameColumnOp(
      { table: { schema: "public", name: "users" }, _newCol: c1.id },
      "email_address",
    );
    const fk = makeAddFkOp(
      [{ table: { schema: "public", name: "orders" }, column: "user_id" }],
      [{ table: { schema: "public", name: "users" }, column: "id" }],
      "orders_user_id_fkey",
    );
    const out = generateDdl(usersOrders, [c1, r1, fk]);
    // Add+rename of new col coalesces to single ADD with final name.
    expect(out.sql).toContain(
      'ALTER TABLE "public"."users" ADD COLUMN "email_address" TEXT NOT NULL',
    );
    expect(out.sql).not.toContain("RENAME COLUMN");
    expect(out.sql).toContain(
      'ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id")',
    );
  });

  it("renameTable on existing -> ALTER TABLE RENAME TO", () => {
    const r = makeRenameTableOp({ schema: "public", name: "users" }, "members");
    const out = generateDdl(usersOrders, [r]);
    expect(out.sql).toContain('ALTER TABLE "public"."users" RENAME TO "members"');
  });

  it("renameColumn on existing -> ALTER TABLE RENAME COLUMN", () => {
    const r = makeRenameColumnOp(
      { table: { schema: "public", name: "users" }, column: "id" },
      "user_id",
    );
    const out = generateDdl(usersOrders, [r]);
    expect(out.sql).toContain('ALTER TABLE "public"."users" RENAME COLUMN "id" TO "user_id"');
  });

  it("retypeColumn on existing -> ALTER TABLE ALTER COLUMN TYPE + nullability", () => {
    const r = makeRetypeColumnOp(
      { table: { schema: "public", name: "orders" }, column: "user_id" },
      "INTEGER",
      true,
    );
    const out = generateDdl(usersOrders, [r]);
    expect(out.sql).toContain('ALTER TABLE "public"."orders" ALTER COLUMN "user_id" TYPE INTEGER');
    expect(out.sql).toContain('ALTER TABLE "public"."orders" ALTER COLUMN "user_id" DROP NOT NULL');
  });

  it("composite FK on existing tables", () => {
    const fk = makeAddFkOp(
      [
        { table: { schema: "public", name: "orders" }, column: "user_id" },
        { table: { schema: "public", name: "orders" }, column: "id" },
      ],
      [
        { table: { schema: "public", name: "users" }, column: "id" },
        { table: { schema: "public", name: "users" }, column: "id" },
      ],
      "orders_composite_fkey",
    );
    const out = generateDdl(usersOrders, [fk]);
    expect(out.sql).toContain(
      'FOREIGN KEY ("user_id", "id") REFERENCES "public"."users" ("id", "id")',
    );
  });

  it("statements array emit-order: CREATE → ALTER → FK", () => {
    const t1 = makeAddTableOp("public", "events");
    const c1 = makeAddColumnOp(
      { schema: "public", name: "users" },
      "tenant_id",
      "BIGINT",
      false,
      false,
    );
    const fk = makeAddFkOp(
      [{ table: { _new: t1.id }, column: "id" }], // points to events.id (seed)
      [{ table: { schema: "public", name: "users" }, column: "id" }],
      "events_id_fkey",
    );
    const out = generateDdl(usersOrders, [c1, t1, fk]);
    const sqls = out.statements.map((s) => s.sql);
    const createIdx = sqls.findIndex((s) => s.startsWith("CREATE TABLE"));
    const alterIdx = sqls.findIndex((s) => s.startsWith('ALTER TABLE "public"."users" ADD COLUMN'));
    const fkIdx = sqls.findIndex((s) => s.includes("ADD CONSTRAINT"));
    expect(createIdx).toBeLessThan(alterIdx);
    expect(alterIdx).toBeLessThan(fkIdx);
  });

  it("identifier quoting escapes double quotes", () => {
    const t = makeAddTableOp("public", `weird"name`);
    const out = generateDdl(empty, [t]);
    expect(out.sql).toContain(`CREATE TABLE "public"."weird""name"`);
  });

  // S20 — forward generation for new op kinds
  it("dropTable emits DROP TABLE on existing table", () => {
    const op = makeDropTableOp({ schema: "public", name: "users" });
    const out = generateDdl(usersOrders, [op]);
    expect(out.sql).toContain('DROP TABLE "public"."users"');
  });

  it("dropColumn emits ALTER TABLE … DROP COLUMN", () => {
    const op = makeDropColumnOp({
      table: { schema: "public", name: "orders" },
      column: "user_id",
    });
    const out = generateDdl(usersOrders, [op]);
    expect(out.sql).toContain('ALTER TABLE "public"."orders" DROP COLUMN "user_id"');
  });

  it("dropFk emits ALTER TABLE … DROP CONSTRAINT", () => {
    const op = makeDropFkOp({ schema: "public", name: "orders" }, "orders_user_fk");
    const out = generateDdl(usersOrders, [op]);
    expect(out.sql).toContain('ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_user_fk"');
  });

  it("setColumnNullable false → SET NOT NULL", () => {
    const op = makeSetColumnNullableOp(
      { table: { schema: "public", name: "users" }, column: "id" },
      false,
    );
    const out = generateDdl(usersOrders, [op]);
    expect(out.sql).toContain('ALTER TABLE "public"."users" ALTER COLUMN "id" SET NOT NULL');
  });

  it("setColumnNullable true → DROP NOT NULL", () => {
    const op = makeSetColumnNullableOp(
      { table: { schema: "public", name: "users" }, column: "id" },
      true,
    );
    const out = generateDdl(usersOrders, [op]);
    expect(out.sql).toContain('ALTER TABLE "public"."users" ALTER COLUMN "id" DROP NOT NULL');
  });

  it("addPrimaryKey emits ADD PRIMARY KEY", () => {
    const op = makeAddPrimaryKeyOp({ schema: "public", name: "users" }, ["id"]);
    const out = generateDdl(usersOrders, [op]);
    expect(out.sql).toContain('ALTER TABLE "public"."users" ADD PRIMARY KEY ("id")');
  });

  it("addPrimaryKey on multi-column composite", () => {
    const op = makeAddPrimaryKeyOp({ schema: "public", name: "orders" }, ["id", "user_id"]);
    const out = generateDdl(usersOrders, [op]);
    expect(out.sql).toContain('ADD PRIMARY KEY ("id", "user_id")');
  });
});
