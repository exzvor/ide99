// — minimal local fallback for tableState.fromDefinition.
// TODO(B3->B4 integrate): swap to `introspect/tableState.ts` once B4 lands.

import type { TableDefinition } from "../../../lib/tauri";
import type { ColumnForm, ConstraintForm, IndexForm, TableForm } from "../ddl/types";

export function tableFormFromDefinition(def: TableDefinition): TableForm {
  const columns: ColumnForm[] = def.columns.map((c) => ({
    id: crypto.randomUUID(),
    name: c.name,
    typeText: c.typeText,
    nullable: c.nullable,
    default: c.default,
    generated: c.generated,
    comment: c.comment,
  }));

  const constraints: ConstraintForm[] = def.constraints.map((c) => {
    const id = crypto.randomUUID();
    if (c.kind === "pk") {
      return { id, kind: "pk", columns: c.columns };
    }
    if (c.kind === "unique") {
      return { id, kind: "unique", name: c.name, columns: c.columns };
    }
    if (c.kind === "fk") {
      return {
        id,
        kind: "fk",
        name: c.name,
        columns: c.columns,
        refSchema: c.refSchema ?? "public",
        refTable: c.refTable ?? "",
        refColumns: c.refColumns,
      };
    }
    return { id, kind: "check", name: c.name, expression: c.expression ?? "" };
  });

  const indexes: IndexForm[] = def.indexes
    .filter((idx) => !idx.primary) // PK index is implicit; constraint covers it.
    .map((idx) => ({
      id: crypto.randomUUID(),
      name: idx.name,
      schema: idx.schema,
      table: idx.table,
      method: ((
        ["btree", "hash", "gin", "gist", "brin", "spgist", "hnsw", "ivfflat"] as const
      ).find((m) => m === idx.method) ?? "btree") as IndexForm["method"],
      unique: idx.unique,
      columns: idx.columns.map((expr) => ({ expr })),
      include: idx.include,
      predicate: idx.predicate,
      withOptions: {},
    }));

  return {
    schema: def.schema,
    name: def.name,
    comment: def.comment,
    columns,
    constraints,
    indexes,
    rls: { enabled: def.rlsEnabled, policies: [] },
    partition: def.partition,
  };
}
