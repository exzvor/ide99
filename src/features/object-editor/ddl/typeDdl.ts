// — pure DDL generator for the four custom-type sub-kinds:
// enum, composite, domain, range.
//
// Diffs are id-keyed (enum values, composite fields, domain constraints) so
// renames are detected instead of emitting destructive drop+add.
//
// Postgres restrictions surfaced as warnings:
// - Enum reorder/rename → DROP+CREATE (`enum_recreate_required`)
// - Range body changes → DROP+CREATE (`range_recreate_required`)

import { quoteIdent, quoteString } from "./helpers";
import type {
  CompositeTypeForm,
  DdlResult,
  DomainTypeForm,
  EnumTypeForm,
  EnumValueForm,
  RangeTypeForm,
} from "./types";

export type TypeKind = "enum" | "composite" | "domain" | "range";
export type TypeFormUnion =
  | { kind: "enum"; form: EnumTypeForm; initial: EnumTypeForm | null }
  | { kind: "composite"; form: CompositeTypeForm; initial: CompositeTypeForm | null }
  | { kind: "domain"; form: DomainTypeForm; initial: DomainTypeForm | null }
  | { kind: "range"; form: RangeTypeForm; initial: RangeTypeForm | null };

export function generateTypeDdl(input: TypeFormUnion): DdlResult {
  switch (input.kind) {
    case "enum":
      return enumDdl(input.initial, input.form);
    case "composite":
      return compositeDdl(input.initial, input.form);
    case "domain":
      return domainDdl(input.initial, input.form);
    case "range":
      return rangeDdl(input.initial, input.form);
  }
}

function fqName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

function enumDdl(initial: EnumTypeForm | null, current: EnumTypeForm): DdlResult {
  const fq = fqName(current.schema, current.name);
  if (!initial) {
    return {
      sql: `CREATE TYPE ${fq} AS ENUM (${current.values.map((v) => quoteString(v.value)).join(", ")});`,
      warnings: [],
      errors: [],
    };
  }
  // Diff by id. Detect reorder/rename → DROP+CREATE.
  const initialById = new Map(initial.values.map((v) => [v.id, v.value]));
  const reordered = isReordered(initial.values, current.values);
  const renamed = current.values.some(
    (v) => initialById.has(v.id) && initialById.get(v.id) !== v.value,
  );
  if (reordered || renamed) {
    const drop = `DROP TYPE ${fq} CASCADE;`;
    const create = enumDdl(null, current).sql;
    return {
      sql: `${drop}\n${create}`,
      warnings: [
        {
          code: "enum_recreate_required",
          message:
            "Postgres cannot reorder or rename enum values in place. Falling back to DROP+CREATE — columns of this enum type will be dropped (CASCADE).",
        },
      ],
      errors: [],
    };
  }
  // Pure appends → ADD VALUE statements with positional AFTER.
  const stmts: string[] = [];
  for (let i = 0; i < current.values.length; i++) {
    const v = current.values[i];
    if (initialById.has(v.id)) continue;
    const after = current.values[i - 1];
    const stmt =
      after && initialById.has(after.id)
        ? `ALTER TYPE ${fq} ADD VALUE ${quoteString(v.value)} AFTER ${quoteString(after.value)};`
        : `ALTER TYPE ${fq} ADD VALUE ${quoteString(v.value)};`;
    stmts.push(stmt);
  }
  return { sql: stmts.join("\n"), warnings: [], errors: [] };
}

function isReordered(before: EnumValueForm[], after: EnumValueForm[]): boolean {
  // Compare positions of common ids.
  const beforeOrder = before.map((v) => v.id);
  const afterCommon = after.filter((v) => beforeOrder.includes(v.id)).map((v) => v.id);
  return beforeOrder.filter((id) => afterCommon.includes(id)).join("|") !== afterCommon.join("|");
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

function compositeDdl(initial: CompositeTypeForm | null, current: CompositeTypeForm): DdlResult {
  const fq = fqName(current.schema, current.name);
  if (!initial) {
    const cols = current.fields
      .map(
        (f) =>
          `${quoteIdent(f.fieldName)} ${f.typeText}${f.collation ? ` COLLATE ${quoteIdent(f.collation)}` : ""}`,
      )
      .join(", ");
    return { sql: `CREATE TYPE ${fq} AS (${cols});`, warnings: [], errors: [] };
  }
  const initialById = new Map(initial.fields.map((f) => [f.id, f]));
  const currentById = new Map(current.fields.map((f) => [f.id, f]));
  const stmts: string[] = [];
  if (initial.schema !== current.schema || initial.name !== current.name) {
    stmts.push(
      `ALTER TYPE ${fqName(initial.schema, initial.name)} RENAME TO ${quoteIdent(current.name)};`,
    );
  }
  for (const f of current.fields) {
    const before = initialById.get(f.id);
    if (!before) {
      stmts.push(`ALTER TYPE ${fq} ADD ATTRIBUTE ${quoteIdent(f.fieldName)} ${f.typeText};`);
    } else {
      if (before.fieldName !== f.fieldName) {
        stmts.push(
          `ALTER TYPE ${fq} RENAME ATTRIBUTE ${quoteIdent(before.fieldName)} TO ${quoteIdent(f.fieldName)};`,
        );
      }
      if (before.typeText !== f.typeText) {
        stmts.push(
          `ALTER TYPE ${fq} ALTER ATTRIBUTE ${quoteIdent(f.fieldName)} TYPE ${f.typeText};`,
        );
      }
    }
  }
  for (const f of initial.fields) {
    if (!currentById.has(f.id)) {
      stmts.push(`ALTER TYPE ${fq} DROP ATTRIBUTE ${quoteIdent(f.fieldName)};`);
    }
  }
  return { sql: stmts.join("\n"), warnings: [], errors: [] };
}

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

function domainDdl(initial: DomainTypeForm | null, current: DomainTypeForm): DdlResult {
  const fq = fqName(current.schema, current.name);
  if (!initial) {
    let head = `CREATE DOMAIN ${fq} AS ${current.baseType}`;
    if (current.collation) head += ` COLLATE ${quoteIdent(current.collation)}`;
    if (current.default !== undefined) head += ` DEFAULT ${current.default}`;
    if (current.notNull) head += " NOT NULL";
    const lines: string[] = [`${head};`];
    for (const c of current.constraints) {
      const namePart = c.constraintName ? `CONSTRAINT ${quoteIdent(c.constraintName)} ` : "";
      const notValid = c.notValid ? " NOT VALID" : "";
      lines.push(`ALTER DOMAIN ${fq} ADD ${namePart}CHECK (${c.checkExpression})${notValid};`);
    }
    return { sql: lines.join("\n"), warnings: [], errors: [] };
  }
  const stmts: string[] = [];
  if (initial.default !== current.default) {
    stmts.push(
      current.default !== undefined
        ? `ALTER DOMAIN ${fq} SET DEFAULT ${current.default};`
        : `ALTER DOMAIN ${fq} DROP DEFAULT;`,
    );
  }
  if (initial.notNull !== current.notNull) {
    stmts.push(`ALTER DOMAIN ${fq} ${current.notNull ? "SET NOT NULL" : "DROP NOT NULL"};`);
  }
  const initialById = new Map(initial.constraints.map((c) => [c.id, c]));
  const currentById = new Map(current.constraints.map((c) => [c.id, c]));
  for (const c of current.constraints) {
    const before = initialById.get(c.id);
    if (!before) {
      const namePart = c.constraintName ? `CONSTRAINT ${quoteIdent(c.constraintName)} ` : "";
      const notValid = c.notValid ? " NOT VALID" : "";
      stmts.push(`ALTER DOMAIN ${fq} ADD ${namePart}CHECK (${c.checkExpression})${notValid};`);
    } else if (
      before.constraintName !== c.constraintName &&
      before.constraintName &&
      c.constraintName
    ) {
      stmts.push(
        `ALTER DOMAIN ${fq} RENAME CONSTRAINT ${quoteIdent(before.constraintName)} TO ${quoteIdent(c.constraintName)};`,
      );
    }
  }
  for (const c of initial.constraints) {
    if (!currentById.has(c.id) && c.constraintName) {
      stmts.push(`ALTER DOMAIN ${fq} DROP CONSTRAINT ${quoteIdent(c.constraintName)};`);
    }
  }
  return { sql: stmts.join("\n"), warnings: [], errors: [] };
}

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

function rangeDdl(initial: RangeTypeForm | null, current: RangeTypeForm): DdlResult {
  const fq = fqName(current.schema, current.name);
  if (!initial) {
    const opts: string[] = [`subtype = ${current.subtype}`];
    if (current.subtypeOpclass) opts.push(`subtype_opclass = ${current.subtypeOpclass}`);
    if (current.collation) opts.push(`collation = ${quoteIdent(current.collation)}`);
    if (current.canonical) opts.push(`canonical = ${current.canonical}`);
    if (current.subtypeDiff) opts.push(`subtype_diff = ${current.subtypeDiff}`);
    if (current.multirangeTypeName)
      opts.push(`multirange_type_name = ${quoteIdent(current.multirangeTypeName)}`);
    return {
      sql: `CREATE TYPE ${fq} AS RANGE (${opts.join(", ")});`,
      warnings: [],
      errors: [],
    };
  }
  if (
    initial.schema === current.schema &&
    initial.name !== current.name &&
    rangeBodyEqual(initial, current)
  ) {
    return {
      sql: `ALTER TYPE ${fqName(initial.schema, initial.name)} RENAME TO ${quoteIdent(current.name)};`,
      warnings: [],
      errors: [],
    };
  }
  if (rangeBodyEqual(initial, current)) {
    return { sql: "", warnings: [], errors: [] };
  }
  const drop = `DROP TYPE ${fqName(initial.schema, initial.name)} CASCADE;`;
  const create = rangeDdl(null, current).sql;
  return {
    sql: `${drop}\n${create}`,
    warnings: [
      {
        code: "range_recreate_required",
        message:
          "Postgres cannot ALTER range types in place. Falling back to DROP+CREATE — columns of this range type will be dropped (CASCADE).",
      },
    ],
    errors: [],
  };
}

function rangeBodyEqual(a: RangeTypeForm, b: RangeTypeForm): boolean {
  return (
    a.subtype === b.subtype &&
    a.subtypeOpclass === b.subtypeOpclass &&
    a.collation === b.collation &&
    a.canonical === b.canonical &&
    a.subtypeDiff === b.subtypeDiff &&
    a.multirangeTypeName === b.multirangeTypeName
  );
}
