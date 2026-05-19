/**
 * — canonical SELECT renderer for the Generated SQL panel.
 *
 * Distinct from `features/editor/queryShape/regenerate.ts`: that module
 * surgically patches WHERE / ORDER BY / LIMIT spans in the user's ORIGINAL
 * editor text so projection / formatting / comments stay byte-for-byte
 * intact. The Bidirectional panel instead needs a CANONICAL pretty-printed
 * form so the learner sees a clean, complete SQL statement reflecting the
 * shape — even when the editor buffer is empty or unparseable.
 */
import type { Filter, QueryShape, Sort } from "../../lib/parser";

/** Render a `QueryShape` as a canonical, pretty-printed `SELECT … FROM …`. */
export function shapeToSql(shape: QueryShape): string {
  const lines: string[] = [];
  lines.push(`SELECT ${renderProjection(shape.baseSelect.columns)}`);
  lines.push(`FROM ${qualifyTable(shape.baseSelect.schema, shape.baseSelect.table)}`);
  if (shape.filters.length > 0) {
    lines.push(`WHERE ${shape.filters.map(filterToSql).join("\n  AND ")}`);
  }
  if (shape.sort) {
    lines.push(renderOrderBy(shape.sort));
  }
  if (shape.limit !== null) {
    lines.push(`LIMIT ${shape.limit}`);
  }
  return lines.join("\n");
}

function renderProjection(columns: string[]): string {
  if (columns.length === 0) return "*";
  return columns.map((c) => (c === "*" ? "*" : `"${c}"`)).join(", ");
}

function qualifyTable(schema: string | null, table: string): string {
  const t = `"${table}"`;
  return schema ? `"${schema}".${t}` : t;
}

function renderOrderBy(sort: Sort): string {
  return `ORDER BY "${sort.column}" ${sort.dir.toUpperCase()}`;
}

function filterToSql(f: Filter): string {
  const col = `"${f.column}"`;
  switch (f.op) {
    case "eq":
      return `${col} = ${formatValue(f.value)}`;
    case "ne":
      return `${col} <> ${formatValue(f.value)}`;
    case "lt":
      return `${col} < ${formatValue(f.value)}`;
    case "le":
      return `${col} <= ${formatValue(f.value)}`;
    case "gt":
      return `${col} > ${formatValue(f.value)}`;
    case "ge":
      return `${col} >= ${formatValue(f.value)}`;
    case "like":
      return `${col} LIKE ${formatValue(f.value)}`;
    case "isNull":
      return `${col} IS NULL`;
    case "isNotNull":
      return `${col} IS NOT NULL`;
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  const s = String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Stable signature of a shape's WHERE clause — used to detect filter changes
 * for the subtle pulse highlight in the Bidirectional panel. Returns a
 * deterministic string that only depends on the WHERE filters.
 */
export function whereSignature(shape: QueryShape | null): string {
  if (!shape) return "";
  return shape.filters.map((f) => `${f.column}|${f.op}|${formatValue(f.value)}`).join("&");
}
