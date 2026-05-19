import { describe, expect, it } from "vitest";
import type { ErdSchemaGraph } from "../../../lib/tauri";
import { makeAddColumnOp, makeAddFkOp, makeAddTableOp } from "./ops";
import { validateOps } from "./validation";

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

describe("validateOps", () => {
  it("clean op-log returns empty issues", () => {
    const op = makeAddColumnOp({ schema: "public", name: "users" }, "name", "TEXT", true, false);
    expect(validateOps(usersBase, [op])).toEqual([]);
  });

  it("empty table name -> error", () => {
    const op = makeAddTableOp("public", "");
    const issues = validateOps(usersBase, [op]);
    expect(issues).toContainEqual({
      kind: "empty-name",
      opId: op.id,
      field: "table",
      severity: "error",
    });
  });

  it("empty column name -> error", () => {
    const op = makeAddColumnOp({ schema: "public", name: "users" }, "", "TEXT", true, false);
    const issues = validateOps(usersBase, [op]);
    expect(issues).toContainEqual({
      kind: "empty-name",
      opId: op.id,
      field: "column",
      severity: "error",
    });
  });

  it("duplicate-table conflict against base -> error", () => {
    const op = makeAddTableOp("public", "users");
    const issues = validateOps(usersBase, [op]);
    expect(issues).toContainEqual({
      kind: "duplicate-table",
      opId: op.id,
      schema: "public",
      name: "users",
      severity: "error",
    });
  });

  it("duplicate-table conflict against another new table -> error", () => {
    const a = makeAddTableOp("public", "orders");
    const b = makeAddTableOp("public", "orders");
    const issues = validateOps(usersBase, [a, b]);
    expect(issues.some((i) => i.kind === "duplicate-table" && i.opId === b.id)).toBe(true);
  });

  it("duplicate-column within same existing table -> error", () => {
    const op = makeAddColumnOp({ schema: "public", name: "users" }, "email", "TEXT", true, false);
    const issues = validateOps(usersBase, [op]);
    expect(issues.some((i) => i.kind === "duplicate-column" && i.opId === op.id)).toBe(true);
  });

  it("new table with empty seedColumns triggers no-columns error", () => {
    const op = makeAddTableOp("public", "events", []);
    const issues = validateOps(usersBase, [op]);
    expect(issues.some((i) => i.kind === "no-columns" && i.opId === op.id)).toBe(true);
  });

  it("FK target column not PK/UNIQUE -> warning", () => {
    const op = makeAddFkOp(      [{ table: { schema: "public", name: "users" }, column: "id" }],
      [{ table: { schema: "public", name: "users" }, column: "email" }], // email not PK
      "users_self_fkey",
);
    const issues = validateOps(usersBase, [op]);
    expect(      issues.some(        (i) => i.kind === "fk-target-not-unique" && i.opId === op.id && i.severity === "warning",
),
).toBe(true);
  });

  it("FK type mismatch -> warning", () => {
    const op = makeAddFkOp(      [{ table: { schema: "public", name: "users" }, column: "email" }], // text
      [{ table: { schema: "public", name: "users" }, column: "id" }], // bigint
      "users_email_fkey",
);
    const issues = validateOps(usersBase, [op]);
    expect(issues.some((i) => i.kind === "fk-type-mismatch" && i.severity === "warning")).toBe(      true,
);
  });
});
