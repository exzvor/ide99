/**
 * — Pure TypeScript mirror of the Rust sql_gen module.
 *
 * Best-effort TS function that produces the same SQL as the Rust backend.
 * Used for INSTANT preview before the IPC roundtrip lands.
 *
 * IMPORTANT: The canonical SQL fed to [Generate] MUST come from the IPC
 * `jsonbBuilderPreview` call. This function is for instant UX only.
 */

import type {
  BuilderPreview,
  BuilderRequest,
  BuilderWarning,
  Comparator,
  PathSegment,
} from "../../../lib/tauri";

/**
 * Local properly-typed alias for BuilderValue.
 * The tauri.ts version is typed as `unknown` due to z.ZodType<unknown> on the
 * recursive schema. We re-declare the shape here for type safety within the
 * module; the runtime values are identical.
 */
export type BuilderValue =
  | { kind: "none" }
  | { kind: "null" }
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "jsonLiteral"; value: string };

/** Locally-typed version of BuilderRequest for internal use. */
type LocalExtractMode = { kind: "projection" } | { kind: "comparison"; eqValue: BuilderValue };

type LocalBuilderOp =
  | { kind: "existence" }
  | { kind: "containment" }
  | { kind: "pathExtract"; mode: LocalExtractMode }
  | { kind: "pathPredicate"; comparator: Comparator; rhs: BuilderValue };

interface LocalBuilderRequest {
  connId: string;
  fqn: { schema: string; table: string; column: string };
  op: LocalBuilderOp;
  path: PathSegment[];
  value: BuilderValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Identifier quoting (mirrors Rust `quote_ident` / `quote_qualified`)
// ─────────────────────────────────────────────────────────────────────────────

function quoteIdent(name: string): string {
  if (name.length === 0 || name.length > 63 || name.includes("\0")) {
    throw new Error(`invalid identifier: ${JSON.stringify(name)}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// String escape helpers
// ─────────────────────────────────────────────────────────────────────────────

function escapeStringLiteral(s: string): string {
  if (s.includes("\0")) {
    throw new Error("string contains NUL byte");
  }
  return s.replace(/'/g, "''");
}

function escapeJsonpathString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Encode path as a PostgreSQL array literal: `{a,b,c}` */
function encodePathArray(path: PathSegment[]): string {
  const parts = path.map((seg) => {
    if (seg === "arraywildcard") return "*";
    return seg.key;
  });
  return `{${parts.join(",")}}`;
}

/** Build nested JSON object from path inward (for containment). */
function containmentObject(path: PathSegment[], value: BuilderValue): string {
  const innerJson = valueToJson(value);
  // Build from inside out (reduce from right)
  return [...path].reverse().reduce((acc, seg) => {
    if (seg === "arraywildcard") return `[${acc}]`;
    const keyJson = JSON.stringify(seg.key);
    return `{${keyJson}: ${acc}}`;
  }, innerJson);
}

/** Build JSONPath accessor string: `"a"."b"[*]` */
function jsonpathAccessor(path: PathSegment[]): string {
  let out = "";
  for (const seg of path) {
    if (seg === "arraywildcard") {
      out += "[*]";
    } else {
      if (out.length > 0 && !out.endsWith("[*]")) {
        out += ".";
      } else if (out.endsWith("[*]")) {
        out += ".";
      }
      const escaped = seg.key.replace(/"/g, '\\"');
      out += `"${escaped}"`;
    }
  }
  return out;
}

function comparatorToJsonpath(c: Comparator): string {
  switch (c) {
    case "eq":
      return "==";
    case "ne":
      return "!=";
    case "gt":
      return ">";
    case "lt":
      return "<";
    case "ge":
      return ">=";
    case "le":
      return "<=";
    case "likeRegex":
      return "like_regex";
  }
}

/** Derive existence key: last Key segment in path, else String value, else "". */
function existenceKey(path: PathSegment[], value: BuilderValue): string {
  // Prefer last Key segment
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i];
    if (seg && seg !== "arraywildcard") return seg.key;
  }
  if (value.kind === "string") return value.value;
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Value conversion
// ─────────────────────────────────────────────────────────────────────────────

function valueToJson(value: BuilderValue): string {
  switch (value.kind) {
    case "none":
    case "null":
      return "null";
    case "bool":
      return value.value ? "true" : "false";
    case "string":
      return JSON.stringify(value.value);
    case "number": {
      const n = Number(value.value);
      if (Number.isNaN(n)) throw new Error(`not a number: ${value.value}`);
      return value.value;
    }
    case "jsonLiteral": {
      // Validate + normalize
      const parsed = JSON.parse(value.value) as unknown;
      return JSON.stringify(parsed);
    }
  }
}

function valueAsJsonbCast(value: BuilderValue): string {
  const json = valueToJson(value);
  const escaped = escapeStringLiteral(json);
  return `'${escaped}'::jsonb`;
}

function valueToJsonpathRhs(value: BuilderValue): string {
  switch (value.kind) {
    case "none":
    case "null":
      return "null";
    case "bool":
      return value.value ? "true" : "false";
    case "string":
      return JSON.stringify(value.value);
    case "number": {
      const n = Number(value.value);
      if (Number.isNaN(n)) throw new Error(`not a number: ${value.value}`);
      return value.value;
    }
    case "jsonLiteral": {
      const parsed = JSON.parse(value.value) as unknown;
      return JSON.stringify(parsed);
    }
  }
}

function jsonpathPredicate(path: PathSegment[], comparator: Comparator, rhs: BuilderValue): string {
  const pathStr = jsonpathAccessor(path);
  const opStr = comparatorToJsonpath(comparator);
  const rhsStr = valueToJsonpathRhs(rhs);
  if (pathStr.length === 0) {
    return `@ ${opStr} ${rhsStr}`;
  }
  return `${pathStr} ? (@ ${opStr} ${rhsStr})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

const PATH_DEPTH_LIMIT = 16;

/**
 * Generate a SQL preview for the given builder request.
 * Returns null on any error (the IPC call will report the exact error).
 */
export function generateLocalPreview(req: BuilderRequest): BuilderPreview | null {
  // Cast to locally-typed version for safe narrowing. The runtime shape
  // is identical; `BuilderValue` in tauri.ts is `unknown` due to schema typing.
  const r = req as unknown as LocalBuilderRequest;
  try {
    const depth = r.path.length;

    if (depth > PATH_DEPTH_LIMIT) return null;

    const warnings: BuilderWarning[] = [];
    if (depth === PATH_DEPTH_LIMIT) {
      warnings.push({ kind: "pathTooDeep", limit: PATH_DEPTH_LIMIT });
    }

    const fqt = quoteQualified(r.fqn.schema, r.fqn.table);
    const col = quoteIdent(r.fqn.column);

    let sql: string;

    switch (r.op.kind) {
      case "existence": {
        if (r.path.length > 0) {
          warnings.push({ kind: "existenceTopLevel" });
        }
        const key = existenceKey(r.path, r.value);
        const escapedKey = escapeStringLiteral(key);
        sql = `SELECT * FROM ${fqt} WHERE ${col} ? '${escapedKey}' LIMIT 100`;
        break;
      }

      case "containment": {
        const jsonVal = containmentObject(r.path, r.value);
        const escaped = escapeStringLiteral(jsonVal);
        sql = `SELECT * FROM ${fqt} WHERE ${col} @> '${escaped}'::jsonb LIMIT 100`;
        break;
      }

      case "pathExtract": {
        const mode = r.op.mode;
        const pathArr = encodePathArray(r.path);
        if (mode.kind === "projection") {
          sql = `SELECT ${col}#>'${pathArr}' AS extracted FROM ${fqt} LIMIT 100`;
        } else {
          const valSql = valueAsJsonbCast(mode.eqValue);
          sql = `SELECT * FROM ${fqt} WHERE ${col}#>'${pathArr}' = ${valSql} LIMIT 100`;
        }
        break;
      }

      case "pathPredicate": {
        const pred = jsonpathPredicate(r.path, r.op.comparator, r.op.rhs);
        const escapedPred = escapeJsonpathString(pred);
        sql = `SELECT * FROM ${fqt} WHERE ${col} @? '$.${escapedPred}' LIMIT 100`;
        break;
      }
    }

    return { sql, warnings };
  } catch {
    return null;
  }
}
