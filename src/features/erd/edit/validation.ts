import type { ErdSchemaGraph } from "../../../lib/tauri";
import type { ColumnRef, Op, OpId } from "./ops";
import type { ValidationIssue } from "./types";

export function validateOps(base: ErdSchemaGraph, ops: Op[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const baseTableSet = new Set(base.tables.map((t) => `${t.schema}.${t.name}`));
  const newTableNames = new Map<OpId, { schema: string; name: string; cols: number }>();

  // Pre-pass: gather addTable -> final name + initial col count.
  for (const op of ops) {
    if (op.kind === "addTable") {
      newTableNames.set(op.id, { schema: op.schema, name: op.name, cols: op.seedColumns.length });
    }
  }
  for (const op of ops) {
    if (op.kind === "renameTable" && "_new" in op.table) {
      const cur = newTableNames.get(op.table._new);
      if (cur) cur.name = op.newName;
    }
    if (op.kind === "addColumn" && "_new" in op.table) {
      const cur = newTableNames.get(op.table._new);
      if (cur) cur.cols += 1;
    }
  }

  for (const op of ops) {
    switch (op.kind) {
      case "addTable": {
        if (op.name.trim() === "") {
          issues.push({ kind: "empty-name", opId: op.id, field: "table", severity: "error" });
        }
        const final = newTableNames.get(op.id)!;
        const fqn = `${final.schema}.${final.name}`;
        if (baseTableSet.has(fqn)) {
          issues.push({
            kind: "duplicate-table",
            opId: op.id,
            schema: final.schema,
            name: final.name,
            severity: "error",
          });
        }
        // Duplicate against another new table
        for (const [otherId, other] of newTableNames) {
          if (otherId === op.id) continue;
          if (other.schema === final.schema && other.name === final.name) {
            // Mark only the *later* op as duplicate to avoid double-flagging.
            const myIdx = ops.findIndex((o) => o.id === op.id);
            const otherIdx = ops.findIndex((o) => o.id === otherId);
            if (myIdx > otherIdx) {
              issues.push({
                kind: "duplicate-table",
                opId: op.id,
                schema: final.schema,
                name: final.name,
                severity: "error",
              });
            }
          }
        }
        if (final.cols === 0) {
          issues.push({ kind: "no-columns", opId: op.id, severity: "error" });
        }
        for (const s of op.seedColumns) {
          if (s.name.trim() === "") {
            issues.push({ kind: "empty-name", opId: op.id, field: "column", severity: "error" });
          }
        }
        break;
      }
      case "addColumn": {
        if (op.name.trim() === "") {
          issues.push({ kind: "empty-name", opId: op.id, field: "column", severity: "error" });
        }
        // Duplicate column within target table (existing table only — for new tables we'd need
        // full applyOps; basic existing check covers the common bug)
        if (!("_new" in op.table)) {
          const tableRef = op.table;
          const t = base.tables.find(            (t) => t.schema === tableRef.schema && t.name === tableRef.name,
);
          if (t?.columns.some((c) => c.name === op.name)) {
            issues.push({
              kind: "duplicate-column",
              opId: op.id,
              tableRef: op.table,
              column: op.name,
              severity: "error",
            });
          }
        }
        break;
      }
      case "renameTable":
      case "renameColumn": {
        const newName = op.kind === "renameTable" ? op.newName : op.newName;
        if (newName.trim() === "") {
          issues.push({
            kind: "empty-name",
            opId: op.id,
            field: op.kind === "renameTable" ? "table" : "column",
            severity: "error",
          });
        }
        break;
      }
      case "addFk": {
        if (op.constraintName.trim() === "") {
          issues.push({ kind: "empty-name", opId: op.id, field: "constraint", severity: "error" });
        }
        // Type-mismatch + target-not-unique only checkable when both sides are existing in base.
        const srcType = lookupBaseType(base, op.sourceColumns[0]);
        const tgtType = lookupBaseType(base, op.targetColumns[0]);
        if (srcType && tgtType && srcType !== tgtType) {
          issues.push({
            kind: "fk-type-mismatch",
            opId: op.id,
            sourceType: srcType,
            targetType: tgtType,
            severity: "warning",
          });
        }
        const tgtIsPkOrUnique = isBaseTargetPkOrUnique(base, op.targetColumns[0]);
        if (tgtIsPkOrUnique === false) {
          issues.push({ kind: "fk-target-not-unique", opId: op.id, severity: "warning" });
        }
        break;
      }
    }
  }

  return issues;
}

function lookupBaseType(base: ErdSchemaGraph, cr: ColumnRef): string | undefined {
  if ("_newCol" in cr) return undefined;
  if ("_new" in cr.table) return undefined;
  const tableRef = cr.table;
  const t = base.tables.find((t) => t.schema === tableRef.schema && t.name === tableRef.name);
  return t?.columns.find((c) => c.name === cr.column)?.dataType.toLowerCase();
}

function isBaseTargetPkOrUnique(base: ErdSchemaGraph, cr: ColumnRef): boolean | undefined {
  if ("_newCol" in cr) return undefined;
  if ("_new" in cr.table) return undefined;
  const tableRef = cr.table;
  const t = base.tables.find((t) => t.schema === tableRef.schema && t.name === tableRef.name);
  const c = t?.columns.find((c) => c.name === cr.column);
  if (!c) return undefined;
  return c.isPrimaryKey;
}
