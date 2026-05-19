// — IndexDefinition → IndexForm transform.

import type { IndexDefinition } from "../../../lib/tauri";
import type { IndexColumnForm, IndexForm } from "../ddl/types";

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

export function fromDefinition(def: IndexDefinition): IndexForm {
  // Map column names to the IndexColumnForm shape with expr-only — we don't
  // surface direction/nulls/opclass from the basic introspect payload (those
  // would require parsing `pg_get_indexdef` output, deferred to v1.0 polish).
  const columns: IndexColumnForm[] = def.columns.map((name) => ({
    expr: name,
  }));
  return {
    id: crypto.randomUUID(),
    name: def.name,
    schema: def.schema,
    table: def.table,
    method: coerceIndexMethod(def.method),
    unique: def.unique,
    columns,
    include: def.include,
    predicate: def.predicate,
    withOptions: {},
  };
}
