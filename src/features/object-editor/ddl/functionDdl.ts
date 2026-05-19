// — pure CREATE OR REPLACE FUNCTION / ALTER FUNCTION generator.
//
// API: `generateFunctionDdl(initial, current)` — `initial === null` ⇒ create-mode,
// otherwise diff-mode.
//
// Edit-mode design choice: whenever the body / language / return / non-typed
// metadata change, we emit a single `CREATE OR REPLACE FUNCTION` (which also
// covers attribute-only changes — volatility / parallel / security / cost / rows).
// Per-attribute `ALTER FUNCTION` would require N statements; CREATE OR REPLACE
// preserves dependencies and is atomic. Signature changes (param count/types/order)
// require DROP + CREATE because PG keys functions by signature.

import { qualifiedName, quoteIdent } from "./helpers";
import type { DdlError, DdlResult, DdlWarning, FunctionForm, FunctionParameter } from "./types";

export function generateFunctionDdl(  initial: FunctionForm | null,
  current: FunctionForm,
): DdlResult {
  const errors = validate(current);
  const warnings: DdlWarning[] = [];
  if (errors.length > 0) return { sql: "", warnings, errors };

  if (initial === null) {
    return { sql: createSql(current), warnings, errors };
  }

  // No diff at all.
  if (!diffExists(initial, current)) {
    return { sql: "", warnings, errors };
  }

  const sigChanged = signatureChanged(initial, current);

  // Rename-only fast path: same signature, only `name` (and/or schema) changed,
  // and nothing else.
  if (!sigChanged && isOnlyRename(initial, current)) {
    return {
      sql: `ALTER FUNCTION ${ref(initial)}(${formatParameterTypes(initial.parameters)}) RENAME TO ${quoteIdent(current.name)};`,
      warnings,
      errors,
    };
  }

  if (sigChanged) {
    warnings.push({
      code: "function_signature_changed",
      message: "Dropping old function signature creates overload risk if other code references it",
    });
    const drop = `DROP FUNCTION ${ref(initial)}(${formatParameterTypes(initial.parameters)});`;
    return { sql: `${drop}\n${createSql(current)}`, warnings, errors };
  }

  // Same signature → CREATE OR REPLACE handles body/lang/return/attribute changes.
  return { sql: createSql(current), warnings, errors };
}

// ────────────────── validation ──────────────────

function validate(form: FunctionForm): DdlError[] {
  const errors: DdlError[] = [];
  if (!form.name.trim()) {
    errors.push({ code: "name_required", message: "Function name is required" });
  }
  if (!form.body.trim()) {
    errors.push({ code: "body_required", message: "Function body is required" });
  }
  if (    (form.returnKind === "scalar" || form.returnKind === "setof") &&
    (!form.returnType || !form.returnType.trim())
) {
    errors.push({
      code: "return_type_required",
      message: "Return type is required for scalar/setof functions",
    });
  }
  if (form.language === "other" && (!form.languageOther || !form.languageOther.trim())) {
    errors.push({
      code: "language_other_required",
      message: 'Language name required when language is "other"',
    });
  }
  // Duplicate parameter names (non-empty only).
  const seen = new Set<string>();
  for (const p of form.parameters) {
    const n = p.name.trim();
    if (n === "") continue;
    if (seen.has(n)) {
      errors.push({
        code: "duplicate_param_name",
        message: `Duplicate parameter name: "${n}"`,
      });
    }
    seen.add(n);
  }
  // VARIADIC must be last.
  for (let i = 0; i < form.parameters.length - 1; i++) {
    if (form.parameters[i].mode === "variadic") {
      errors.push({
        code: "variadic_not_last",
        message: "VARIADIC parameter must be the last parameter",
      });
      break;
    }
  }
  return errors;
}

// ────────────────── create ──────────────────

function createSql(f: FunctionForm): string {
  const fnRef = ref(f);
  const params = formatParameters(f.parameters);
  const paramBlock = params === "" ? "()" : `(\n    ${params}\n)`;
  const ret = returnClause(f);
  const lang = languageString(f);

  const tail: string[] = [`LANGUAGE ${lang}`];
  if (f.volatility !== "volatile") tail.push(f.volatility.toUpperCase());
  if (f.parallelSafety !== "unsafe") tail.push(`PARALLEL ${f.parallelSafety.toUpperCase()}`);
  if (f.securityDefiner) tail.push("SECURITY DEFINER");
  if (f.cost !== null) tail.push(`COST ${f.cost}`);
  if (f.estimatedRows !== null) tail.push(`ROWS ${f.estimatedRows}`);

  let sql =
    `CREATE OR REPLACE FUNCTION ${fnRef}${paramBlock} ${ret} AS $function$\n` +
    `${f.body}\n` +
    `$function$ ${tail.join(" ")};`;

  if (f.comment !== null) {
    sql += `\nCOMMENT ON FUNCTION ${fnRef}(${formatParameterTypes(f.parameters)}) IS '${escapeSqlString(f.comment)}';`;
  }
  return sql;
}

function returnClause(f: FunctionForm): string {
  switch (f.returnKind) {
    case "void":
      return "RETURNS void";
    case "trigger":
      return "RETURNS TRIGGER";
    case "setof":
      return `RETURNS SETOF ${f.returnType}`;
    case "scalar":
      return `RETURNS ${f.returnType}`;
  }
}

function languageString(f: FunctionForm): string {
  if (f.language === "other") return (f.languageOther ?? "").toLowerCase();
  return f.language.toLowerCase();
}

function formatParameters(params: FunctionParameter[]): string {
  return params.map(formatParameter).join(",\n    ");
}

function formatParameter(p: FunctionParameter): string {
  const parts: string[] = [];
  if (p.name.trim() !== "") parts.push(p.name);
  parts.push(p.mode.toUpperCase(), p.type);
  let s = parts.join(" ");
  if (p.default !== null && p.default.trim() !== "") {
    s += ` DEFAULT ${p.default}`;
  }
  return s;
}

/** Comma-separated TYPES only — used inside DROP FUNCTION / RENAME / COMMENT signatures. */
export function formatParameterTypes(params: FunctionParameter[]): string {
  // PG signature only uses IN/INOUT/VARIADIC for matching; OUT params don't
  // contribute to the signature. Most editor flows produce IN-only params,
  // but we still filter OUT for correctness.
  return params
    .filter((p) => p.mode !== "out")
    .map((p) => (p.mode === "variadic" ? `VARIADIC ${p.type}` : p.type))
    .join(", ");
}

// ────────────────── diff helpers ──────────────────

function ref(f: FunctionForm): string {
  return qualifiedName(f.schema, f.name);
}

function diffExists(a: FunctionForm, b: FunctionForm): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function signatureChanged(a: FunctionForm, b: FunctionForm): boolean {
  if (a.parameters.length !== b.parameters.length) return true;
  for (let i = 0; i < a.parameters.length; i++) {
    const pa = a.parameters[i];
    const pb = b.parameters[i];
    if (pa.mode !== pb.mode) return true;
    if (pa.type.trim().toLowerCase() !== pb.type.trim().toLowerCase()) return true;
  }
  return false;
}

function isOnlyRename(a: FunctionForm, b: FunctionForm): boolean {
  if (a.name === b.name && a.schema === b.schema) return false;
  // Compare everything else by clearing name/schema and serializing.
  const stripped = (f: FunctionForm) => ({ ...f, name: "", schema: "" });
  return JSON.stringify(stripped(a)) === JSON.stringify(stripped(b));
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}
