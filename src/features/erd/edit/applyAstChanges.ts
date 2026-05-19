// src/features/erd/edit/applyAstChanges.ts
//
// S20 reverse-mapper: takes a list of `DdlChange` produced by the Rust
// `parser_parse_ddl` command and projects it onto the canonical S19 op log
// (`Op[]`). The frontend store later replaces its current ops with the
// derived list, which the existing forward `generateDdl` re-renders into the
// DDL panel — closing the bidirectional loop without intermediate state.
//
// Mapping is intentionally lossy in two directions:
// 1. AST features outside the Op vocabulary (CHECK, INDEX, RLS, …) are
// surfaced as `AstWarning` rather than thrown.
// 2. AST node references that don't resolve against `base` or against an
// in-batch `addTable` are also surfaced as warnings.

import type { DdlChange } from "../../../lib/parser";
import type { ErdSchemaGraph } from "../../../lib/tauri";
import {
  type AnyTableRef,
  type ColumnRef,
  type Op,
  type SeedColumn,
  makeAddColumnOp,
  makeAddFkOp,
  makeAddPrimaryKeyOp,
  makeAddTableOp,
  makeDropColumnOp,
  makeDropFkOp,
  makeDropTableOp,
  makeRenameColumnOp,
  makeRenameTableOp,
  makeRetypeColumnOp,
  makeSetColumnNullableOp,
  newOpId,
} from "./ops";

export interface AstWarning {
  message: string;
  sqlSnippet?: string;
}

export interface ApplyAstResult {
  ops: Op[];
  warnings: AstWarning[];
}

export function deriveOpsFromAst(base: ErdSchemaGraph, changes: DdlChange[]): ApplyAstResult {
  const ops: Op[] = [];
  const warnings: AstWarning[] = [];
  // For tables added in this batch, remember addTable.id by "schema.name".
  const newTables = new Map<string, string>();

  for (const c of changes) {
    switch (c.kind) {
      case "createTable": {
        const seedColumns: SeedColumn[] = c.columns.map((col) => ({
          opId: newOpId(),
          name: col.name,
          dataType: col.dataType,
          nullable: col.nullable,
          identity: col.identity,
          primaryKey: col.isPrimaryKey,
        }));
        const op = makeAddTableOp(c.schema, c.name, seedColumns);
        newTables.set(`${c.schema}.${c.name}`, op.id);
        ops.push(op);
        break;
      }
      case "dropTable": {
        if (!findExistingTable(base, c.schema, c.name)) {
          warnings.push({
            message: `Cannot drop ${c.schema}.${c.name}: table not found in base schema`,
          });
          break;
        }
        ops.push(makeDropTableOp({ schema: c.schema, name: c.name }));
        break;
      }
      case "renameTable": {
        const ref = resolveTable(base, newTables, c.schema, c.oldName);
        if (!ref) {
          warnings.push({ message: `Cannot rename ${c.schema}.${c.oldName}: table not found` });
          break;
        }
        // makeRenameTableOp forces TableRef|NewTableRef — both branches OK
        ops.push(makeRenameTableOp(ref, c.newName));
        break;
      }
      case "addColumn": {
        const ref = resolveTable(base, newTables, c.schema, c.table);
        if (!ref) {
          warnings.push({
            message: `Cannot ADD COLUMN on ${c.schema}.${c.table}: table not found`,
          });
          break;
        }
        ops.push(          makeAddColumnOp(            ref,
            c.column.name,
            c.column.dataType,
            c.column.nullable,
            c.column.isPrimaryKey,
),
);
        break;
      }
      case "dropColumn": {
        const ref = resolveTable(base, newTables, c.schema, c.table);
        if (!ref) {
          warnings.push({
            message: `Cannot DROP COLUMN on ${c.schema}.${c.table}: table not found`,
          });
          break;
        }
        const colRef: ColumnRef = { table: ref, column: c.column };
        ops.push(makeDropColumnOp(colRef));
        break;
      }
      case "renameColumn": {
        const ref = resolveTable(base, newTables, c.schema, c.table);
        if (!ref) {
          warnings.push({
            message: `Cannot RENAME COLUMN on ${c.schema}.${c.table}: table not found`,
          });
          break;
        }
        const colRef: ColumnRef = { table: ref, column: c.oldName };
        ops.push(makeRenameColumnOp(colRef, c.newName));
        break;
      }
      case "alterColumnType": {
        const ref = resolveTable(base, newTables, c.schema, c.table);
        if (!ref) {
          warnings.push({
            message: `Cannot ALTER COLUMN TYPE on ${c.schema}.${c.table}: table not found`,
          });
          break;
        }
        const existingTable = findExistingTable(base, c.schema, c.table);
        const existingCol = existingTable?.columns.find((col) => col.name === c.column);
        // If column is in base, default to its current nullable; otherwise true.
        const currentNullable = existingCol?.nullable ?? true;
        const colRef: ColumnRef = { table: ref, column: c.column };
        ops.push(makeRetypeColumnOp(colRef, c.newType, currentNullable));
        break;
      }
      case "alterColumnNullable": {
        const ref = resolveTable(base, newTables, c.schema, c.table);
        if (!ref) {
          warnings.push({
            message: `Cannot ALTER COLUMN NULL on ${c.schema}.${c.table}: table not found`,
          });
          break;
        }
        const colRef: ColumnRef = { table: ref, column: c.column };
        ops.push(makeSetColumnNullableOp(colRef, c.nullable));
        break;
      }
      case "addPrimaryKey": {
        const ref = resolveTable(base, newTables, c.schema, c.table);
        if (!ref) {
          warnings.push({
            message: `Cannot ADD PK on ${c.schema}.${c.table}: table not found`,
          });
          break;
        }
        ops.push(makeAddPrimaryKeyOp(ref, c.columns));
        break;
      }
      case "addForeignKey": {
        const sourceRef = resolveTable(base, newTables, c.schema, c.table);
        const targetRef = resolveTable(base, newTables, c.refSchema, c.refTable);
        if (!sourceRef || !targetRef) {
          warnings.push({
            message: `Cannot add FK ${c.schema}.${c.table} → ${c.refSchema}.${c.refTable}: table not found`,
          });
          break;
        }
        const sourceCols: ColumnRef[] = c.columns.map((col) => ({ table: sourceRef, column: col }));
        const targetCols: ColumnRef[] = c.refColumns.map((col) => ({
          table: targetRef,
          column: col,
        }));
        const constraintName = c.name ?? `${c.table}_${c.columns.join("_")}_fkey`;
        ops.push(makeAddFkOp(sourceCols, targetCols, constraintName));
        break;
      }
      case "dropConstraint": {
        const ref = resolveTable(base, newTables, c.schema, c.table);
        if (!ref) {
          warnings.push({
            message: `Cannot DROP CONSTRAINT on ${c.schema}.${c.table}: table not found`,
          });
          break;
        }
        // ERD only knows about FKs by name. If the constraint is not a known
        // FK, surface a warning — DDL still applies on Apply, ERD just doesn't
        // reflect the drop.
        const isFk = base.foreignKeys.some(          (fk) =>
            fk.name === c.constraint && fk.sourceSchema === c.schema && fk.sourceTable === c.table,
);
        if (isFk) {
          ops.push(makeDropFkOp(ref, c.constraint));
        } else {
          warnings.push({
            message: `DROP CONSTRAINT "${c.constraint}" on ${c.schema}.${c.table} — not a known FK; DDL applies but ERD won't reflect`,
          });
        }
        break;
      }
      case "unrepresentable":
        warnings.push({ message: c.reason, sqlSnippet: c.sqlSnippet });
        break;
    }
  }

  return { ops, warnings };
}

function findExistingTable(base: ErdSchemaGraph, schema: string, name: string) {
  return base.tables.find((t) => t.schema === schema && t.name === name);
}

function resolveTable(  base: ErdSchemaGraph,
  newTables: Map<string, string>,
  schema: string,
  name: string,
): AnyTableRef | null {
  if (findExistingTable(base, schema, name)) return { schema, name };
  const opId = newTables.get(`${schema}.${name}`);
  if (opId) return { _new: opId };
  return null;
}
