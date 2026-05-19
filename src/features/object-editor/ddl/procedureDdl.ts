// — pure CREATE OR REPLACE PROCEDURE / ALTER PROCEDURE generator.
//
// Mirrors functionDdl minus return clause / volatility / parallel / cost / rows.
// Edit-mode design: same as functionDdl — CREATE OR REPLACE for body/lang/params
// (when signature unchanged), DROP+CREATE for signature change, ALTER PROCEDURE
// RENAME for name-only change.

import { formatParameterTypes } from "./functionDdl";
import { qualifiedName, quoteIdent } from "./helpers";
import type { DdlError, DdlResult, DdlWarning, FunctionParameter, ProcedureForm } from "./types";

export function generateProcedureDdl(
  initial: ProcedureForm | null,
  current: ProcedureForm,
): DdlResult {
  const errors = validate(current);
  const warnings: DdlWarning[] = [];
  if (errors.length > 0) return { sql: "", warnings, errors };

  if (initial === null) {
    return { sql: createSql(current), warnings, errors };
  }

  if (!diffExists(initial, current)) {
    return { sql: "", warnings, errors };
  }

  const sigChanged = signatureChanged(initial, current);

  if (!sigChanged && isOnlyRename(initial, current)) {
    return {
      sql: `ALTER PROCEDURE ${ref(initial)}(${formatParameterTypes(initial.parameters)}) RENAME TO ${quoteIdent(current.name)};`,
      warnings,
      errors,
    };
  }

  if (sigChanged) {
    warnings.push({
      code: "procedure_signature_changed",
      message: "Dropping old procedure signature creates overload risk if other code references it",
    });
    const drop = `DROP PROCEDURE ${ref(initial)}(${formatParameterTypes(initial.parameters)});`;
    return { sql: `${drop}\n${createSql(current)}`, warnings, errors };
  }

  return { sql: createSql(current), warnings, errors };
}

// ────────────────── validation ──────────────────

function validate(form: ProcedureForm): DdlError[] {
  const errors: DdlError[] = [];
  if (!form.name.trim()) {
    errors.push({ code: "name_required", message: "Procedure name is required" });
  }
  if (!form.body.trim()) {
    errors.push({ code: "body_required", message: "Procedure body is required" });
  }
  if (form.language === "other" && (!form.languageOther || !form.languageOther.trim())) {
    errors.push({
      code: "language_other_required",
      message: 'Language name required when language is "other"',
    });
  }
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

function createSql(p: ProcedureForm): string {
  const procRef = ref(p);
  const params = formatParameters(p.parameters);
  const paramBlock = params === "" ? "()" : `(\n    ${params}\n)`;
  const lang = languageString(p);

  const tail: string[] = [`LANGUAGE ${lang}`];
  if (p.securityDefiner) tail.push("SECURITY DEFINER");

  let sql =
    `CREATE OR REPLACE PROCEDURE ${procRef}${paramBlock} AS $procedure$\n` +
    `${p.body}\n` +
    `$procedure$ ${tail.join(" ")};`;

  if (p.comment !== null) {
    sql += `\nCOMMENT ON PROCEDURE ${procRef}(${formatParameterTypes(p.parameters)}) IS '${escapeSqlString(p.comment)}';`;
  }
  return sql;
}

function languageString(p: ProcedureForm): string {
  if (p.language === "other") return (p.languageOther ?? "").toLowerCase();
  return p.language.toLowerCase();
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

// ────────────────── diff helpers ──────────────────

function ref(p: ProcedureForm): string {
  return qualifiedName(p.schema, p.name);
}

function diffExists(a: ProcedureForm, b: ProcedureForm): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function signatureChanged(a: ProcedureForm, b: ProcedureForm): boolean {
  if (a.parameters.length !== b.parameters.length) return true;
  for (let i = 0; i < a.parameters.length; i++) {
    const pa = a.parameters[i];
    const pb = b.parameters[i];
    if (pa.mode !== pb.mode) return true;
    if (pa.type.trim().toLowerCase() !== pb.type.trim().toLowerCase()) return true;
  }
  return false;
}

function isOnlyRename(a: ProcedureForm, b: ProcedureForm): boolean {
  if (a.name === b.name && a.schema === b.schema) return false;
  const stripped = (f: ProcedureForm) => ({ ...f, name: "", schema: "" });
  return JSON.stringify(stripped(a)) === JSON.stringify(stripped(b));
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}
