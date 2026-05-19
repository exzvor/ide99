// — small, pure helpers shared by the per-kind DDL generators.
//
// Lives apart from `src/features/erd/edit/ddlGen.ts` (S20) because the
// object-editor scope is wider (views, sequences, RLS, generated columns)
// and we don't want to touch that stable file. The two systems may converge
// later — for now they intentionally duplicate the small bits (`q` /
// `quoteIdent`).

import type { ColumnForm, ConstraintForm, ReferentialAction } from "./types";

/** Postgres reserved keywords — minimal subset (~35) covering the spec list
 * plus a couple obvious extras. Stored upper-cased; lookup is case-insensitive. */
const RESERVED_KEYWORDS = new Set<string>([
  "SELECT",
  "FROM",
  "WHERE",
  "TABLE",
  "USER",
  "ORDER",
  "GROUP",
  "BY",
  "LIMIT",
  "OFFSET",
  "UNION",
  "AS",
  "IN",
  "IS",
  "NOT",
  "NULL",
  "TRUE",
  "FALSE",
  "AND",
  "OR",
  "JOIN",
  "INNER",
  "OUTER",
  "LEFT",
  "RIGHT",
  "ON",
  "USING",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "INDEX",
  "VIEW",
]);

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

/** Returns the SQL representation of an identifier, double-quoting it when
 * the name contains anything outside `[a-z_][a-z0-9_]*` OR matches a
 * Postgres reserved keyword. Inner `"` are doubled. */
export function quoteIdent(name: string): string {
  const needsQuotes = !SAFE_IDENT.test(name) || RESERVED_KEYWORDS.has(name.toUpperCase());
  if (!needsQuotes) return name;
  return `"${name.replace(/"/g, `""`)}"`;
}

/** Single-quote a SQL string literal, doubling any embedded single quotes. */
export function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Schema-qualified identifier `"schema"."name"` — both parts quoted via
 * `quoteIdent`. Use everywhere a generator concatenates a schema with a
 * relation/function name; raw `${schema}.${quoteIdent(name)}` breaks
 * schemas with dashes, uppercase, spaces, or non-ASCII letters. */
export function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

/** Uppercase the type name; preserve `(…)` modifiers and `[]` array suffix. */
export function formatType(typeText: string): string {
  return typeText.trim().toUpperCase();
}

/** Comma-join a list. */
export function joinList(items: string[], sep = ", "): string {
  return items.join(sep);
}

/** `"name" TYPE [NOT NULL] [DEFAULT …] [GENERATED ALWAYS AS (…) STORED]`. */
export function formatColumnDef(col: ColumnForm): string {
  const parts: string[] = [quoteIdent(col.name), formatType(col.typeText)];
  if (!col.nullable) parts.push("NOT NULL");
  if (col.default !== null) parts.push(`DEFAULT ${col.default}`);
  if (col.generated !== null) {
    parts.push(`GENERATED ALWAYS AS (${col.generated.expression}) STORED`);
  }
  return parts.join(" ");
}

const REF_ACTION_SQL: Record<ReferentialAction, string> = {
  no_action: "NO ACTION",
  restrict: "RESTRICT",
  cascade: "CASCADE",
  set_null: "SET NULL",
  set_default: "SET DEFAULT",
};

/** Renders a constraint as `[CONSTRAINT "name"] PRIMARY KEY (…)` etc. */
export function formatConstraintDef(c: ConstraintForm): string {
  const namePrefix = "name" in c && c.name ? `CONSTRAINT ${quoteIdent(c.name)} ` : "";
  if (c.kind === "pk") {
    return `${namePrefix}PRIMARY KEY (${c.columns.map(quoteIdent).join(", ")})`;
  }
  if (c.kind === "unique") {
    return `${namePrefix}UNIQUE (${c.columns.map(quoteIdent).join(", ")})`;
  }
  if (c.kind === "fk") {
    const cols = c.columns.map(quoteIdent).join(", ");
    const refCols = c.refColumns.map(quoteIdent).join(", ");
    let sql = `${namePrefix}FOREIGN KEY (${cols}) REFERENCES ${qualifiedName(c.refSchema, c.refTable)} (${refCols})`;
    if (c.onDelete) sql += ` ON DELETE ${REF_ACTION_SQL[c.onDelete]}`;
    if (c.onUpdate) sql += ` ON UPDATE ${REF_ACTION_SQL[c.onUpdate]}`;
    return sql;
  }
  // check
  return `${namePrefix}CHECK (${c.expression})`;
}
