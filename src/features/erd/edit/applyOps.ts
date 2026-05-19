import type { ErdSchemaGraph } from "../../../lib/tauri";
import type { AnyTableRef, ColumnRef, Op, OpId } from "./ops";
import type { WorkingColumn, WorkingErdGraph, WorkingFk, WorkingTable } from "./types";

/**
 * Pure: play `ops` forward against `base` to produce the WorkingErdGraph
 * that Canvas + DdlPreviewPanel render from. moveTable ops are skipped here
 * (they feed positions.ts cache, not the structural graph).
 */
export function applyOps(base: ErdSchemaGraph, ops: Op[]): WorkingErdGraph {
  const tables = new Map<string, WorkingTable>();
  const fks: WorkingFk[] = [];
  const newTableOpIds = new Set<OpId>();

  // Seed from base.
  for (const t of base.tables) {
    const cols: WorkingColumn[] = t.columns.map((c) => ({
      id: c.name, // existing column id == its original name (immutable in op-log)
      name: c.name,
      dataType: c.dataType,
      nullable: c.nullable,
      isPrimaryKey: c.isPrimaryKey,
      identity: false, // base never reports identity; treated as plain column for redisplay
      isForeignKey: c.isForeignKey,
    }));
    tables.set(tableId({ schema: t.schema, name: t.name }), {
      id: tableId({ schema: t.schema, name: t.name }),
      schema: t.schema,
      name: t.name,
      columns: cols,
    });
  }
  for (const fk of base.foreignKeys) {
    fks.push({
      id: `existing:${fk.name}`,
      name: fk.name,
      source: {
        tableId: tableId({ schema: fk.sourceSchema, name: fk.sourceTable }),
        columnIds: [...fk.sourceColumns],
      },
      target: {
        tableId: tableId({ schema: fk.targetSchema, name: fk.targetTable }),
        columnIds: [...fk.targetColumns],
      },
    });
  }

  for (const op of ops) {
    switch (op.kind) {
      case "addTable": {
        const id = newTableId(op.id);
        const cols: WorkingColumn[] = op.seedColumns.map((s) => ({
          id: `_new:${s.opId}`,
          name: s.name,
          dataType: s.dataType,
          nullable: s.nullable,
          isPrimaryKey: s.primaryKey,
          identity: s.identity,
          isForeignKey: false,
          addOpId: s.opId,
        }));
        tables.set(id, {
          id,
          schema: op.schema,
          name: op.name,
          columns: cols,
          addOpId: op.id,
        });
        newTableOpIds.add(op.id);
        break;
      }
      case "addColumn": {
        const tid = resolveTableId(op.table);
        const t = tables.get(tid);
        if (!t) break;
        t.columns.push({
          id: `_new:${op.id}`,
          name: op.name,
          dataType: op.dataType,
          nullable: op.nullable,
          isPrimaryKey: op.isPrimaryKey,
          identity: false,
          isForeignKey: false,
          addOpId: op.id,
        });
        break;
      }
      case "renameTable": {
        const tid = resolveTableId(op.table);
        const t = tables.get(tid);
        if (!t) break;
        if (!t.addOpId && t.originalName === undefined) t.originalName = t.name;
        t.name = op.newName;
        break;
      }
      case "renameColumn": {
        const c = resolveColumn(tables, op.column);
        if (!c) break;
        if (c.addOpId === undefined && c.originalName === undefined) c.originalName = c.name;
        c.name = op.newName;
        break;
      }
      case "retypeColumn": {
        const c = resolveColumn(tables, op.column);
        if (!c) break;
        if (c.addOpId === undefined) {
          if (c.originalDataType === undefined) c.originalDataType = c.dataType;
          if (c.originalNullable === undefined) c.originalNullable = c.nullable;
        }
        c.dataType = op.newDataType;
        c.nullable = op.newNullable;
        break;
      }
      case "addFk": {
        const src = op.sourceColumns
          .map((cr) => resolveColumnRef(tables, cr))
          .filter(Boolean) as ResolvedCol[];
        const tgt = op.targetColumns
          .map((cr) => resolveColumnRef(tables, cr))
          .filter(Boolean) as ResolvedCol[];
        if (src.length !== op.sourceColumns.length || tgt.length !== op.targetColumns.length) break;
        if (src.length === 0 || src.length !== tgt.length) break;
        fks.push({
          id: `_new:${op.id}`,
          name: op.constraintName,
          source: { tableId: src[0].tableId, columnIds: src.map((s) => s.column.id) },
          target: { tableId: tgt[0].tableId, columnIds: tgt.map((t) => t.column.id) },
          addOpId: op.id,
        });
        for (const s of src) s.column.isForeignKey = true;
        break;
      }
      case "moveTable":
        // Position-only — handled by positions.ts cache, not by structural applyOps.
        break;
    }
  }

  return { tables: [...tables.values()], fks, newTableOpIds };
}

// --- helpers ---

function tableId(ref: { schema: string; name: string }): string {
  return `${ref.schema}.${ref.name}`;
}
function newTableId(opId: OpId): string {
  return `_new:${opId}`;
}
function resolveTableId(ref: AnyTableRef): string {
  return "_new" in ref ? `_new:${ref._new}` : tableId(ref);
}
interface ResolvedCol {
  tableId: string;
  column: WorkingColumn;
}
function resolveColumn(
  tables: Map<string, WorkingTable>,
  ref: ColumnRef,
): WorkingColumn | undefined {
  const tid = resolveTableId(ref.table);
  const t = tables.get(tid);
  if (!t) return undefined;
  if ("_newCol" in ref) {
    return t.columns.find((c) => c.addOpId === ref._newCol);
  }
  return t.columns.find((c) => c.id === ref.column);
}
function resolveColumnRef(
  tables: Map<string, WorkingTable>,
  ref: ColumnRef,
): ResolvedCol | undefined {
  const c = resolveColumn(tables, ref);
  if (!c) return undefined;
  return { tableId: resolveTableId(ref.table), column: c };
}
