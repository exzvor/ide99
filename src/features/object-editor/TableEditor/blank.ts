// — blank-form factories. UUIDs come from `crypto.randomUUID()`
// (jsdom has it; production has it). Dependency-light.

import type { ColumnForm, ConstraintForm, IndexForm, TableForm } from "../ddl/types";

export function blankColumn(): ColumnForm {
  return {
    id: crypto.randomUUID(),
    name: "",
    typeText: "TEXT",
    nullable: true,
    default: null,
    generated: null,
    comment: null,
  };
}

export function blankPkConstraint(): ConstraintForm {
  return { id: crypto.randomUUID(), kind: "pk", columns: [] };
}

export function blankUniqueConstraint(): ConstraintForm {
  return { id: crypto.randomUUID(), kind: "unique", columns: [] };
}

export function blankFkConstraint(): ConstraintForm {
  return {
    id: crypto.randomUUID(),
    kind: "fk",
    columns: [],
    refSchema: "public",
    refTable: "",
    refColumns: [],
  };
}

export function blankCheckConstraint(): ConstraintForm {
  return { id: crypto.randomUUID(), kind: "check", expression: "" };
}

export function blankIndexForm(schema: string, table: string): IndexForm {
  return {
    id: crypto.randomUUID(),
    name: "",
    schema,
    table,
    method: "btree",
    unique: false,
    columns: [{ expr: "" }],
    include: [],
    predicate: null,
    withOptions: {},
  };
}

export function blankTableForm(schema: string): TableForm {
  return {
    schema,
    name: "",
    comment: null,
    columns: [blankColumn()],
    constraints: [],
    indexes: [],
    rls: { enabled: false, policies: [] },
    partition: null,
  };
}
