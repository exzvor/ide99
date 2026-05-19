// — pure CREATE TABLE / ALTER TABLE generator for the object-editor.
//
// API: `generateTableDdl(initial, current)` — `initial === null` ⇒ create-mode,
// otherwise diff-mode. Returns concatenated `;`-terminated chunks separated
// by `\n`. Backend `schema_apply_ddl` wraps the entire string in BEGIN/COMMIT.

import { formatColumnDef, formatConstraintDef, qualifiedName, quoteIdent } from "./helpers";
import { renderIndexCreate, renderIndexDrop } from "./indexDdl";
import type {
  ConstraintForm,
  DdlError,
  DdlResult,
  DdlWarning,
  IndexForm,
  TableForm,
} from "./types";

export function generateTableDdl(initial: TableForm | null, current: TableForm): DdlResult {
  const errors: DdlError[] = validate(current);
  const warnings: DdlWarning[] = [];
  if (errors.length > 0) return { sql: "", warnings, errors };

  if (initial === null) {
    return { sql: createSql(current), warnings, errors };
  }
  return { sql: diffSql(initial, current), warnings, errors };
}

// ────────────────── validation ──────────────────

function validate(form: TableForm): DdlError[] {
  const errors: DdlError[] = [];
  if (!form.name.trim()) {
    errors.push({ code: "name_required", message: "Table name is required" });
  }
  // duplicate column names
  const seen = new Set<string>();
  for (const c of form.columns) {
    if (seen.has(c.name)) {
      errors.push({
        code: "duplicate_column",
        message: `Duplicate column name: "${c.name}"`,
      });
    }
    seen.add(c.name);
  }
  const colNames = new Set(form.columns.map((c) => c.name));
  for (const c of form.constraints) {
    if (c.kind === "check" && !c.expression.trim()) {
      errors.push({
        code: "empty_check",
        message: "CHECK constraint must have an expression",
      });
    }
    if (c.kind === "pk") {
      for (const col of c.columns) {
        if (!colNames.has(col)) {
          errors.push({
            code: "pk_unknown_column",
            message: `PRIMARY KEY references unknown column: "${col}"`,
          });
        }
      }
    }
  }
  return errors;
}

// ────────────────── create ──────────────────

function createSql(form: TableForm): string {
  const chunks: string[] = [];
  const colDefs = form.columns.map(formatColumnDef);
  const conDefs = form.constraints.map(formatConstraintDef);
  const body = [...colDefs, ...conDefs].join(",\n    ");
  const tableRef = qualifiedName(form.schema, form.name);
  chunks.push(`CREATE TABLE ${tableRef} (\n    ${body}\n);`);

  if (form.comment !== null && form.comment !== "") {
    chunks.push(`COMMENT ON TABLE ${tableRef} IS '${escapeSqlString(form.comment)}';`);
  }
  for (const idx of form.indexes) {
    chunks.push(`${renderIndexCreate(idx)};`);
  }
  if (form.rls.enabled) {
    chunks.push(`ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY;`);
  }
  return chunks.join("\n");
}

// ────────────────── diff ──────────────────

function diffSql(initial: TableForm, current: TableForm): string {
  const chunks: string[] = [];
  // Resolve "current" table reference for ALTER TABLE — uses NEW schema/name
  // when renamed, but the rename itself emits FIRST so subsequent chunks use
  // the new name.
  const oldRef = qualifiedName(initial.schema, initial.name);
  const newRef = qualifiedName(current.schema, current.name);

  // (1) Rename table.
  if (initial.name !== current.name) {
    chunks.push(`ALTER TABLE ${oldRef} RENAME TO ${quoteIdent(current.name)};`);
  }

  const initIdxById = byId(initial.indexes);
  const curIdxById = byId(current.indexes);
  const initConById = byId(initial.constraints);
  const curConById = byId(current.constraints);
  const initColById = byId(initial.columns);
  const curColById = byId(current.columns);

  // (2) Drop indexes — present in initial but missing in current. Also
  // "modified" indexes (id matches, content differs) drop here, recreate
  // in step 8.
  for (const old of initial.indexes) {
    const next = curIdxById.get(old.id);
    if (next === undefined || indexChanged(old, next)) {
      chunks.push(`${renderIndexDrop(old)};`);
    }
  }

  // (3) Drop constraints — symmetric: missing-in-current OR modified.
  for (const old of initial.constraints) {
    const next = curConById.get(old.id);
    if (next === undefined || constraintChanged(old, next)) {
      chunks.push(`ALTER TABLE ${newRef} DROP CONSTRAINT ${quoteIdent(constraintName(old))};`);
    }
  }

  // (4) Drop columns.
  for (const old of initial.columns) {
    if (!curColById.has(old.id)) {
      chunks.push(`ALTER TABLE ${newRef} DROP COLUMN ${quoteIdent(old.name)};`);
    }
  }

  // (5) For surviving columns, per-col atomic order: rename → type → nullable
  // → default → generated. Walk in CURRENT form order so output is
  // deterministic against the user's view.
  for (const cur of current.columns) {
    const old = initColById.get(cur.id);
    if (old === undefined) continue;
    // 5a — rename first; use the post-rename name for subsequent ALTERs.
    if (old.name !== cur.name) {
      chunks.push(
        `ALTER TABLE ${newRef} RENAME COLUMN ${quoteIdent(old.name)} TO ${quoteIdent(cur.name)};`,
      );
    }
    // 5b — type
    if (formatTypeText(old.typeText) !== formatTypeText(cur.typeText)) {
      chunks.push(
        `ALTER TABLE ${newRef} ALTER COLUMN ${quoteIdent(cur.name)} TYPE ${formatTypeText(cur.typeText)};`,
      );
    }
    // 5c — nullable
    if (old.nullable !== cur.nullable) {
      const action = cur.nullable ? "DROP NOT NULL" : "SET NOT NULL";
      chunks.push(`ALTER TABLE ${newRef} ALTER COLUMN ${quoteIdent(cur.name)} ${action};`);
    }
    // 5d — default
    if (old.default !== cur.default) {
      if (cur.default === null) {
        chunks.push(`ALTER TABLE ${newRef} ALTER COLUMN ${quoteIdent(cur.name)} DROP DEFAULT;`);
      } else {
        chunks.push(
          `ALTER TABLE ${newRef} ALTER COLUMN ${quoteIdent(cur.name)} SET DEFAULT ${cur.default};`,
        );
      }
    }
    // 5e — generated added (toggling off is unsupported by PG inline; skipped)
    if (old.generated === null && cur.generated !== null) {
      chunks.push(
        `ALTER TABLE ${newRef} ALTER COLUMN ${quoteIdent(cur.name)} ADD GENERATED ALWAYS AS (${cur.generated.expression}) STORED;`,
      );
    }
  }

  // (6) Add columns — id not present in initial.
  for (const cur of current.columns) {
    if (!initColById.has(cur.id)) {
      chunks.push(`ALTER TABLE ${newRef} ADD COLUMN ${formatColumnDef(cur)};`);
    }
  }

  // (7) Add constraints — id new in current OR modified (drop already in step 3).
  for (const cur of current.constraints) {
    const old = initConById.get(cur.id);
    if (old === undefined || constraintChanged(old, cur)) {
      chunks.push(`ALTER TABLE ${newRef} ADD ${formatConstraintDef(cur)};`);
    }
  }

  // (8) Add indexes — id new in current OR modified.
  for (const cur of current.indexes) {
    const old = initIdxById.get(cur.id);
    if (old === undefined || indexChanged(old, cur)) {
      chunks.push(`${renderIndexCreate(cur)};`);
    }
  }

  // (9) RLS toggle.
  if (initial.rls.enabled !== current.rls.enabled) {
    chunks.push(
      `ALTER TABLE ${newRef} ${current.rls.enabled ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY;`,
    );
  }

  return chunks.join("\n");
}

// ────────────────── helpers ──────────────────

function byId<T extends { id: string }>(arr: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of arr) m.set(x.id, x);
  return m;
}

function constraintName(c: ConstraintForm): string {
  if ("name" in c && c.name) return c.name;
  // fallback: derive a stable label so we have *something* — should not happen
  // for FK/UQ/CHECK in real edit-mode (introspect always assigns names).
  return c.id;
}

function constraintChanged(a: ConstraintForm, b: ConstraintForm): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function indexChanged(a: IndexForm, b: IndexForm): boolean {
  // Rename-only is handled separately by indexDdl when called standalone.
  // Inside table edits, any index field change → recreate. Compare ignoring
  // name? No — if name changes too, drop+create with new name is correct.
  return JSON.stringify({ ...a, id: "" }) !== JSON.stringify({ ...b, id: "" });
}

function formatTypeText(t: string): string {
  return t.trim().toUpperCase();
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}
