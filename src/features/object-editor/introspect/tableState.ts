// — TableDefinition → TableForm transform.
//
// Pure function. Assigns a fresh UUID to every column / constraint / index so
// the form-state diff (rename detection, reorder tracking) has stable
// identities across edits. The introspected shapes never carry an id of
// their own — the backend describes the catalog, not our local form-state.

import type { ConstraintDefinition, IndexDefinition, TableDefinition } from "../../../lib/tauri";
import type {
  ColumnForm,
  ConstraintForm,
  IndexColumnForm,
  IndexForm,
  TableForm,
} from "../ddl/types";

function mapColumns(def: TableDefinition): ColumnForm[] {
  return def.columns.map((c) => ({
    id: crypto.randomUUID(),
    name: c.name,
    typeText: c.typeText,
    nullable: c.nullable,
    default: c.default,
    generated: c.generated,
    comment: c.comment,
  }));
}

function mapConstraint(c: ConstraintDefinition): ConstraintForm {
  // Most FK fields are already structured (refSchema/refTable/refColumns).
  // We fall back to parsing `definition` only when the structured fields
  // are missing — defensive: the backend always populates them today, but
  // an older introspection payload could omit them.
  const id = crypto.randomUUID();
  switch (c.kind) {
    case "pk":
      return { id, kind: "pk", columns: c.columns };
    case "unique":
      return { id, kind: "unique", name: c.name || undefined, columns: c.columns };
    case "fk": {
      const refSchema = c.refSchema ?? "";
      const refTable = c.refTable ?? "";
      const refColumns = c.refColumns;
      // ON DELETE / ON UPDATE actions are not in the structured payload;
      // they live inside `definition`. S23 surfaces them as undefined
      // (preserves existing behaviour on apply — the generator only emits
      // ON DELETE / ON UPDATE clauses when the user explicitly sets them).
      return {
        id,
        kind: "fk",
        name: c.name || undefined,
        columns: c.columns,
        refSchema,
        refTable,
        refColumns,
      };
    }
    case "check":
      return {
        id,
        kind: "check",
        name: c.name || undefined,
        // expression preferred; fall back to the raw definition (rare).
        expression: c.expression ?? c.definition,
      };
  }
}

const VALID_INDEX_METHODS = new Set([
  "btree",
  "hash",
  "gin",
  "gist",
  "brin",
  "spgist",
  "hnsw",
  "ivfflat",
] as const);
type IndexMethod = IndexForm["method"];

function coerceIndexMethod(method: string): IndexMethod {
  return (VALID_INDEX_METHODS.has(method as IndexMethod) ? method : "btree") as IndexMethod;
}

function mapIndex(idx: IndexDefinition): IndexForm {
  const columns: IndexColumnForm[] = idx.columns.map((name) => ({
    expr: name,
    // S23 introspect doesn't surface direction/nulls/opclass in the basic
    // form — the columns array is whatever pg_get_indexdef returned per-key.
    // Leaving these undefined is the documented fallback.
  }));
  return {
    id: crypto.randomUUID(),
    name: idx.name,
    schema: idx.schema,
    table: idx.table,
    method: coerceIndexMethod(idx.method),
    unique: idx.unique,
    columns,
    include: idx.include,
    predicate: idx.predicate,
    withOptions: {},
  };
}

export function fromDefinition(def: TableDefinition): TableForm {
  return {
    schema: def.schema,
    name: def.name,
    comment: def.comment,
    columns: mapColumns(def),
    constraints: def.constraints.map(mapConstraint),
    indexes: def.indexes.map(mapIndex),
    rls: { enabled: def.rlsEnabled, policies: [] },
    partition: def.partition,
  };
}
