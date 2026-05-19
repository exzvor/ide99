// src/features/erd/edit/applyAstChanges.test.ts
import { describe, expect, it } from "vitest";
import type { DdlChange } from "../../../lib/parser";
import type { ErdSchemaGraph } from "../../../lib/tauri";
import { deriveOpsFromAst } from "./applyAstChanges";

const empty: ErdSchemaGraph = { tables: [], foreignKeys: [], fetchedInMs: 0 };

const usersBase: ErdSchemaGraph = {
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

const ordersWithFk: ErdSchemaGraph = {
  tables: [
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
          isForeignKey: true,
          ordinal: 2,
        },
      ],
    },
  ],
  foreignKeys: [
    {
      name: "orders_user_fk",
      sourceSchema: "public",
      sourceTable: "orders",
      sourceColumns: ["user_id"],
      targetSchema: "public",
      targetTable: "users",
      targetColumns: ["id"],
    },
  ],
  fetchedInMs: 0,
};

describe("deriveOpsFromAst", () => {
  it("createTable → addTable with seedColumns", () => {
    const change: DdlChange = {
      kind: "createTable",
      schema: "public",
      name: "u",
      columns: [
        { name: "id", dataType: "bigint", nullable: false, identity: true, isPrimaryKey: true },
      ],
      primaryKey: ["id"],
    };
    const r = deriveOpsFromAst(empty, [change]);
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0];
    expect(op.kind).toBe("addTable");
    if (op.kind === "addTable") {
      expect(op.schema).toBe("public");
      expect(op.name).toBe("u");
      expect(op.seedColumns).toHaveLength(1);
      expect(op.seedColumns[0].name).toBe("id");
    }
  });

  it("addColumn into existing table", () => {
    const r = deriveOpsFromAst(usersBase, [
      {
        kind: "addColumn",
        schema: "public",
        table: "users",
        column: {
          name: "address",
          dataType: "text",
          nullable: true,
          identity: false,
          isPrimaryKey: false,
        },
      },
    ]);
    expect(r.ops[0].kind).toBe("addColumn");
    if (r.ops[0].kind === "addColumn") {
      expect(r.ops[0].name).toBe("address");
    }
  });

  it("addColumn into unknown table → warning, no op", () => {
    const r = deriveOpsFromAst(empty, [
      {
        kind: "addColumn",
        schema: "public",
        table: "ghost",
        column: {
          name: "x",
          dataType: "int",
          nullable: true,
          identity: false,
          isPrimaryKey: false,
        },
      },
    ]);
    expect(r.ops).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toContain("ghost");
  });

  it("dropTable on existing → dropTable op", () => {
    const r = deriveOpsFromAst(usersBase, [{ kind: "dropTable", schema: "public", name: "users" }]);
    expect(r.ops[0].kind).toBe("dropTable");
  });

  it("dropTable on missing → warning", () => {
    const r = deriveOpsFromAst(empty, [{ kind: "dropTable", schema: "public", name: "ghost" }]);
    expect(r.ops).toHaveLength(0);
    expect(r.warnings[0].message).toContain("ghost");
  });

  it("renameTable on existing → renameTable op", () => {
    const r = deriveOpsFromAst(usersBase, [
      { kind: "renameTable", schema: "public", oldName: "users", newName: "accounts" },
    ]);
    expect(r.ops[0].kind).toBe("renameTable");
    if (r.ops[0].kind === "renameTable") {
      expect(r.ops[0].newName).toBe("accounts");
    }
  });

  it("dropColumn → dropColumn op", () => {
    const r = deriveOpsFromAst(usersBase, [
      { kind: "dropColumn", schema: "public", table: "users", column: "email" },
    ]);
    expect(r.ops[0].kind).toBe("dropColumn");
  });

  it("renameColumn → renameColumn op", () => {
    const r = deriveOpsFromAst(usersBase, [
      {
        kind: "renameColumn",
        schema: "public",
        table: "users",
        oldName: "email",
        newName: "email_address",
      },
    ]);
    expect(r.ops[0].kind).toBe("renameColumn");
  });

  it("alterColumnType uses base nullable", () => {
    const r = deriveOpsFromAst(usersBase, [
      {
        kind: "alterColumnType",
        schema: "public",
        table: "users",
        column: "email",
        newType: "varchar",
      },
    ]);
    expect(r.ops[0].kind).toBe("retypeColumn");
    if (r.ops[0].kind === "retypeColumn") {
      expect(r.ops[0].newDataType).toBe("varchar");
      expect(r.ops[0].newNullable).toBe(true); // email is nullable in base
    }
  });

  it("alterColumnNullable → setColumnNullable op", () => {
    const r = deriveOpsFromAst(usersBase, [
      {
        kind: "alterColumnNullable",
        schema: "public",
        table: "users",
        column: "email",
        nullable: false,
      },
    ]);
    expect(r.ops[0].kind).toBe("setColumnNullable");
    if (r.ops[0].kind === "setColumnNullable") {
      expect(r.ops[0].nullable).toBe(false);
    }
  });

  it("addPrimaryKey → addPrimaryKey op", () => {
    const r = deriveOpsFromAst(usersBase, [
      { kind: "addPrimaryKey", schema: "public", table: "users", columns: ["id"] },
    ]);
    expect(r.ops[0].kind).toBe("addPrimaryKey");
  });

  it("addForeignKey resolves both sides", () => {
    const r = deriveOpsFromAst(
      {
        ...usersBase,
        tables: [
          ...usersBase.tables,
          {
            schema: "public",
            name: "posts",
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
      },
      [
        {
          kind: "addForeignKey",
          schema: "public",
          table: "posts",
          name: "posts_user_fk",
          columns: ["user_id"],
          refSchema: "public",
          refTable: "users",
          refColumns: ["id"],
        },
      ],
    );
    expect(r.ops[0].kind).toBe("addFk");
    if (r.ops[0].kind === "addFk") {
      expect(r.ops[0].constraintName).toBe("posts_user_fk");
    }
  });

  it("dropConstraint of known FK → dropFk", () => {
    const r = deriveOpsFromAst(ordersWithFk, [
      {
        kind: "dropConstraint",
        schema: "public",
        table: "orders",
        constraint: "orders_user_fk",
      },
    ]);
    expect(r.ops[0].kind).toBe("dropFk");
  });

  it("dropConstraint of unknown PK → warning, no op", () => {
    const r = deriveOpsFromAst(usersBase, [
      {
        kind: "dropConstraint",
        schema: "public",
        table: "users",
        constraint: "users_pkey",
      },
    ]);
    expect(r.ops).toHaveLength(0);
    expect(r.warnings[0].message).toContain("not a known FK");
  });

  it("unrepresentable → warning only", () => {
    const r = deriveOpsFromAst(empty, [
      {
        kind: "unrepresentable",
        sqlSnippet: "CREATE INDEX foo",
        reason: "Index DDL not supported",
      },
    ]);
    expect(r.ops).toHaveLength(0);
    expect(r.warnings[0].message).toContain("Index DDL not supported");
    expect(r.warnings[0].sqlSnippet).toBe("CREATE INDEX foo");
  });

  it("createTable + addForeignKey resolves _new ref via in-batch newTables", () => {
    const r = deriveOpsFromAst(usersBase, [
      {
        kind: "createTable",
        schema: "public",
        name: "posts",
        columns: [
          {
            name: "id",
            dataType: "bigint",
            nullable: false,
            identity: true,
            isPrimaryKey: true,
          },
          {
            name: "user_id",
            dataType: "bigint",
            nullable: false,
            identity: false,
            isPrimaryKey: false,
          },
        ],
        primaryKey: ["id"],
      },
      {
        kind: "addForeignKey",
        schema: "public",
        table: "posts",
        name: "posts_user_fk",
        columns: ["user_id"],
        refSchema: "public",
        refTable: "users",
        refColumns: ["id"],
      },
    ]);
    expect(r.ops).toHaveLength(2);
    expect(r.ops[0].kind).toBe("addTable");
    expect(r.ops[1].kind).toBe("addFk");
    if (r.ops[1].kind === "addFk") {
      // source side resolves to a _new ref backed by the addTable id
      const src = r.ops[1].sourceColumns[0];
      expect("_new" in src.table).toBe(true);
    }
  });
});
