// — pure CREATE TRIGGER / ALTER TRIGGER generator.
//
// Postgres has no `ALTER TRIGGER ... <whatever>` for changing timing / events /
// when / function / FOR EACH / table. Any of those changes ⇒ DROP + CREATE.
// Only `RENAME` and `ALTER TABLE … ENABLE/DISABLE TRIGGER` are surgical.

import { qualifiedName, quoteIdent } from "./helpers";
import type { DdlError, DdlResult, DdlWarning, TriggerForm } from "./types";

export function generateTriggerDdl(initial: TriggerForm | null, current: TriggerForm): DdlResult {
  const errors = validate(current);
  const warnings: DdlWarning[] = [];
  if (current.timing === "instead_of") {
    warnings.push({
      code: "instead_of_typically_views",
      message: "INSTEAD OF triggers usually apply to views, not tables",
    });
  }
  if (errors.length > 0) return { sql: "", warnings, errors };

  if (initial === null) {
    return { sql: createSql(current), warnings, errors };
  }

  if (!diffExists(initial, current)) {
    return { sql: "", warnings, errors };
  }

  // Enabled-toggle only.
  if (onlyEnabledChanged(initial, current)) {
    return {
      sql: enabledStatement(current),
      warnings,
      errors,
    };
  }

  // Rename-only (same table, everything else equal).
  if (onlyRenamed(initial, current)) {
    return {
      sql: `ALTER TRIGGER ${quoteIdent(initial.name)} ON ${tableRef(initial.table)} RENAME TO ${quoteIdent(current.name)};`,
      warnings,
      errors,
    };
  }

  // Otherwise: drop + recreate.
  warnings.push({
    code: "trigger_recreate",
    message: "PG does not support ALTER TRIGGER for these attributes",
  });
  const drop = `DROP TRIGGER ${quoteIdent(initial.name)} ON ${tableRef(initial.table)};`;
  return { sql: `${drop}\n${createSql(current)}`, warnings, errors };
}

// ────────────────── validation ──────────────────

function validate(form: TriggerForm): DdlError[] {
  const errors: DdlError[] = [];
  if (!form.name.trim()) {
    errors.push({ code: "name_required", message: "Trigger name is required" });
  }
  const eventCount =
    (form.events.insert ? 1 : 0) +
    (form.events.update ? 1 : 0) +
    (form.events.delete ? 1 : 0) +
    (form.events.truncate ? 1 : 0);
  if (eventCount === 0) {
    errors.push({
      code: "at_least_one_event",
      message: "At least one event must be selected",
    });
  }
  if (form.whenClause !== null && form.forEach === "statement") {
    errors.push({
      code: "when_requires_for_each_row",
      message: "WHEN clause requires FOR EACH ROW",
    });
  }
  if (!form.functionRef.name.trim()) {
    errors.push({ code: "function_required", message: "Trigger function is required" });
  }
  return errors;
}

// ────────────────── create ──────────────────

function createSql(t: TriggerForm): string {
  const lines: string[] = [];
  lines.push(`CREATE TRIGGER ${quoteIdent(t.name)}`);
  lines.push(`    ${timingString(t.timing)} ${eventList(t)} ON ${tableRef(t.table)}`);
  lines.push(`    FOR EACH ${t.forEach.toUpperCase()}`);
  if (t.whenClause !== null) lines.push(`    WHEN (${t.whenClause})`);
  lines.push(`    EXECUTE FUNCTION ${qualifiedName(t.functionRef.schema, t.functionRef.name)}();`);
  let sql = lines.join("\n");
  if (!t.enabled) sql += `\n${enabledStatement(t)}`;
  return sql;
}

function timingString(t: TriggerForm["timing"]): string {
  if (t === "instead_of") return "INSTEAD OF";
  return t.toUpperCase();
}

function eventList(t: TriggerForm): string {
  const parts: string[] = [];
  if (t.events.insert) parts.push("INSERT");
  if (t.events.update) {
    if (t.updateColumns.length > 0) {
      parts.push(`UPDATE OF ${t.updateColumns.map(quoteIdent).join(", ")}`);
    } else {
      parts.push("UPDATE");
    }
  }
  if (t.events.delete) parts.push("DELETE");
  if (t.events.truncate) parts.push("TRUNCATE");
  return parts.join(" OR ");
}

function tableRef(table: { schema: string; name: string }): string {
  return qualifiedName(table.schema, table.name);
}

function enabledStatement(t: TriggerForm): string {
  const action = t.enabled ? "ENABLE" : "DISABLE";
  return `ALTER TABLE ${tableRef(t.table)} ${action} TRIGGER ${quoteIdent(t.name)};`;
}

// ────────────────── diff helpers ──────────────────

function diffExists(a: TriggerForm, b: TriggerForm): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function onlyEnabledChanged(a: TriggerForm, b: TriggerForm): boolean {
  if (a.enabled === b.enabled) return false;
  const stripped = (t: TriggerForm) => ({ ...t, enabled: true });
  return JSON.stringify(stripped(a)) === JSON.stringify(stripped(b));
}

function onlyRenamed(a: TriggerForm, b: TriggerForm): boolean {
  if (a.name === b.name) return false;
  // Same table required (rename without table change).
  if (a.table.schema !== b.table.schema || a.table.name !== b.table.name) return false;
  const stripped = (t: TriggerForm) => ({ ...t, name: "" });
  return JSON.stringify(stripped(a)) === JSON.stringify(stripped(b));
}
