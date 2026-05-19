// — pure CREATE/DROP/ALTER INDEX generator. Standalone API +
// helpers (`renderIndexCreate`, `renderIndexDrop`) consumed by tableDdl.

import { qualifiedName, quoteIdent } from "./helpers";
import type { DdlResult, IndexForm } from "./types";

/** Renders a `CREATE [UNIQUE] INDEX [name] ON …` statement *without* the
 * trailing `;`. Used both as a standalone create statement AND inside
 * tableDdl when emitting inline indexes after CREATE TABLE. */
export function renderIndexCreate(idx: IndexForm): string {
  const unique = idx.unique ? "UNIQUE " : "";
  const namePart = idx.name ? ` ${quoteIdent(idx.name)}` : "";
  const tableRef = qualifiedName(idx.schema, idx.table);
  const cols = idx.columns
    .map((c) => {
      const opclass = c.opclass ? ` ${c.opclass}` : "";
      const dir = c.direction ? ` ${c.direction.toUpperCase()}` : "";
      const nulls = c.nulls ? ` NULLS ${c.nulls.toUpperCase()}` : "";
      return `${c.expr}${opclass}${dir}${nulls}`;
    })
    .join(", ");
  let sql = `CREATE ${unique}INDEX${namePart} ON ${tableRef} USING ${idx.method} (${cols})`;
  const withParts = Object.entries(idx.withOptions ?? {})
    .filter(([, v]) => Number.isFinite(v))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} = ${v}`);
  if (withParts.length > 0) {
    sql += ` WITH (${withParts.join(", ")})`;
  }
  if (idx.include.length > 0) {
    sql += ` INCLUDE (${idx.include.map(quoteIdent).join(", ")})`;
  }
  if (idx.predicate !== null && idx.predicate.trim() !== "") {
    sql += ` WHERE ${idx.predicate}`;
  }
  return sql;
}

/** Renders `DROP INDEX schema.name` without trailing `;`. */
export function renderIndexDrop(idx: IndexForm): string {
  return `DROP INDEX ${qualifiedName(idx.schema, idx.name)}`;
}

export function generateIndexDdl(initial: IndexForm | null, current: IndexForm): DdlResult {
  if (initial === null) {
    return { sql: `${renderIndexCreate(current)};`, warnings: [], errors: [] };
  }
  if (sameIndex(initial, current)) {
    return { sql: "", warnings: [], errors: [] };
  }
  // Rename-only fast path.
  if (onlyDiffersByName(initial, current) && initial.name !== current.name && initial.name !== "") {
    return {
      sql: `ALTER INDEX ${qualifiedName(initial.schema, initial.name)} RENAME TO ${quoteIdent(current.name)};`,
      warnings: [],
      errors: [],
    };
  }
  // Anything else → drop + create + warning.
  return {
    sql: [`${renderIndexDrop(initial)};`, `${renderIndexCreate(current)};`].join("\n"),
    warnings: [
      {
        code: "index_recreate",
        message: "Index method/columns/predicate cannot be altered in place",
      },
    ],
    errors: [],
  };
}

function sameIndex(a: IndexForm, b: IndexForm): boolean {
  return JSON.stringify({ ...a, id: "" }) === JSON.stringify({ ...b, id: "" });
}

function onlyDiffersByName(a: IndexForm, b: IndexForm): boolean {
  return JSON.stringify({ ...a, id: "", name: "" }) === JSON.stringify({ ...b, id: "", name: "" });
}
