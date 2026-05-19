// src/features/editor/queryShape/regenerate.ts
//
// Surgical text patcher: given the ORIGINAL editor text and the desired
// `QueryShape`, rewrite ONLY the WHERE / ORDER BY / LIMIT clauses, leaving
// everything else (SELECT projection, FROM alias, comments, indentation)
// byte-for-byte intact.
//
// We rely on the parser-supplied byte spans (`whereSpan`, `orderBySpan`,
// `limitSpan`) to know which slice of text to replace. If a clause is
// absent in the original, the relevant span is `null` and we INSERT at the
// appropriate anchor (`fromEnd` for WHERE, before LIMIT for ORDER BY).
//
// Edits are collected into a list and applied right-to-left so earlier
// edits don't shift the offsets of later ones.
import type { Filter, QueryShape, Sort } from "../../../lib/parser";

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

export function regenerateSelect(originalText: string, shape: QueryShape): string {
  const edits: Edit[] = [];

  // ─── WHERE ────────────────────────────────────────────────────────────
  if (shape.whereSpan) {
    edits.push({
      start: shape.whereSpan.start,
      end: shape.whereSpan.end,
      replacement: shape.filters.length > 0 ? buildWhere(shape.filters) : "",
    });
  } else if (shape.filters.length > 0) {
    edits.push({
      start: shape.fromEnd,
      end: shape.fromEnd,
      replacement: ` ${buildWhere(shape.filters)}`,
    });
  }

  // ─── ORDER BY ─────────────────────────────────────────────────────────
  if (shape.orderBySpan) {
    edits.push({
      start: shape.orderBySpan.start,
      end: shape.orderBySpan.end,
      replacement: shape.sort ? buildOrderBy(shape.sort) : "",
    });
  } else if (shape.sort) {
    // Insert before LIMIT if present, otherwise at end of statement.
    const anchor = shape.limitSpan?.start ?? originalText.length;
    edits.push({
      start: anchor,
      end: anchor,
      replacement: ` ${buildOrderBy(shape.sort)}`,
    });
  }

  // ─── LIMIT ────────────────────────────────────────────────────────────
  if (shape.limitSpan) {
    edits.push({
      start: shape.limitSpan.start,
      end: shape.limitSpan.end,
      replacement: shape.limit !== null ? `LIMIT ${shape.limit}` : "",
    });
  } else if (shape.limit !== null) {
    edits.push({
      start: originalText.length,
      end: originalText.length,
      replacement: ` LIMIT ${shape.limit}`,
    });
  }

  // Apply right-to-left so offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let result = originalText;
  for (const e of edits) {
    result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
  }

  // Tidy: collapse runs of whitespace introduced by clause removal, then
  // strip trailing whitespace. We deliberately don't touch single-space
  // runs (newlines etc) inside the user's projection — `\s+` would, so
  // we use a guarded form.
  return result.replace(/[ \t]+(\s)/g, "$1").replace(/\s+$/, "");
}

function buildWhere(filters: Filter[]): string {
  return `WHERE ${filters.map(filterToSql).join(" AND ")}`;
}

function buildOrderBy(sort: Sort): string {
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
  // Default: stringify and SQL-escape single quotes.
  const s = String(v);
  return `'${s.replace(/'/g, "''")}'`;
}
