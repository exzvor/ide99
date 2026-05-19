import type { ErdSchemaGraph } from "../../../lib/tauri";
import type { AnyTableRef, ColumnRef, Op, OpId } from "./ops";
import type { DdlGenResult, DdlStatement } from "./types";

export function generateDdl(base: ErdSchemaGraph, ops: Op[]): DdlGenResult {
  const stmts: DdlStatement[] = [];

  // Index ops for cross-referencing.
  const opsById = new Map<OpId, Op>();
  for (const op of ops) opsById.set(op.id, op);

  // newTableNames: opId of addTable -> final name (after renameTable ops applied).
  const newTableFinalName = new Map<OpId, { schema: string; name: string }>();
  for (const op of ops) {
    if (op.kind === "addTable") {
      newTableFinalName.set(op.id, { schema: op.schema, name: op.name });
    }
  }
  for (const op of ops) {
    if (op.kind === "renameTable" && "_new" in op.table) {
      const cur = newTableFinalName.get(op.table._new);
      if (cur) newTableFinalName.set(op.table._new, { schema: cur.schema, name: op.newName });
    }
  }

  // newColFinalName: addColumn opId -> final name. Keys also include seedColumn opIds.
  const newColFinalName = new Map<
    OpId,
    { name: string; dataType: string; nullable: boolean; isPrimaryKey: boolean; identity: boolean }
  >();
  for (const op of ops) {
    if (op.kind === "addTable") {
      for (const s of op.seedColumns) {
        newColFinalName.set(s.opId, {
          name: s.name,
          dataType: s.dataType,
          nullable: s.nullable,
          isPrimaryKey: s.primaryKey,
          identity: s.identity,
        });
      }
    } else if (op.kind === "addColumn") {
      newColFinalName.set(op.id, {
        name: op.name,
        dataType: op.dataType,
        nullable: op.nullable,
        isPrimaryKey: op.isPrimaryKey,
        identity: false,
      });
    }
  }
  for (const op of ops) {
    if (op.kind === "renameColumn" && "_newCol" in op.column) {
      const cur = newColFinalName.get(op.column._newCol);
      if (cur) cur.name = op.newName;
    } else if (op.kind === "retypeColumn" && "_newCol" in op.column) {
      const cur = newColFinalName.get(op.column._newCol);
      if (cur) {
        cur.dataType = op.newDataType;
        cur.nullable = op.newNullable;
      }
    }
  }

  // ---- Group A: CREATE TABLE for each addTable ---------------------------------
  for (const op of ops) {
    if (op.kind !== "addTable") continue;
    const finalT = newTableFinalName.get(op.id)!;
    const cols: string[] = [];
    const inlineFks: string[] = [];

    // seed columns
    for (const s of op.seedColumns) {
      const final = newColFinalName.get(s.opId)!;
      cols.push(emitColumnDef(final));
    }
    // addColumn ops targeting this new table
    for (const inner of ops) {
      if (inner.kind !== "addColumn") continue;
      if (!isNewTableRef(inner.table) || inner.table._new !== op.id) continue;
      const final = newColFinalName.get(inner.id)!;
      cols.push(emitColumnDef(final));
    }
    // self-contained FKs (both sides reference this new table OR another new table)
    for (const inner of ops) {
      if (inner.kind !== "addFk") continue;
      if (!isFkSelfContained(inner, op.id, ops)) continue;
      // inline only when the *source* side belongs to this table
      const srcTableOpId = newTableOpIdForColumnRef(inner.sourceColumns[0], ops);
      if (srcTableOpId !== op.id) continue;
      inlineFks.push(emitInlineFk(inner, newColFinalName, newTableFinalName, base));
    }

    const body = [...cols, ...inlineFks].join(",\n    ");
    stmts.push({
      sql: `CREATE TABLE ${q(finalT.schema)}.${q(finalT.name)} (\n    ${body}\n);`,
      opIds: [op.id],
      warnings: [],
    });
  }

  // ---- Group B: ALTER existing tables ------------------------------------------
  // renameTable on existing
  for (const op of ops) {
    if (op.kind !== "renameTable") continue;
    if (isNewTableRef(op.table)) continue;
    stmts.push({
      sql: `ALTER TABLE ${q(op.table.schema)}.${q(op.table.name)} RENAME TO ${q(op.newName)};`,
      opIds: [op.id],
      warnings: [],
    });
  }
  // addColumn on existing — emit with final name (post any rename) and final type
  const renamedAddColIds = new Set<OpId>();
  for (const op of ops) {
    if (op.kind === "renameColumn" && "_newCol" in op.column)
      renamedAddColIds.add(op.column._newCol);
  }
  for (const op of ops) {
    if (op.kind !== "addColumn") continue;
    if (isNewTableRef(op.table)) continue;
    const final = newColFinalName.get(op.id)!;
    const opIds = [op.id];
    for (const inner of ops) {
      if (
        (inner.kind === "renameColumn" || inner.kind === "retypeColumn") &&
        "_newCol" in inner.column &&
        inner.column._newCol === op.id
      ) {
        opIds.push(inner.id);
      }
    }
    stmts.push({
      sql: `ALTER TABLE ${q(op.table.schema)}.${q(op.table.name)} ADD COLUMN ${emitColumnDef(final)};`,
      opIds,
      warnings: [],
    });
  }
  // renameColumn on existing-base column (NOT _newCol)
  for (const op of ops) {
    if (op.kind !== "renameColumn") continue;
    if ("_newCol" in op.column) continue;
    if ("_new" in op.column.table) continue;
    stmts.push({
      sql: `ALTER TABLE ${q(op.column.table.schema)}.${q(op.column.table.name)} RENAME COLUMN ${q(op.column.column)} TO ${q(op.newName)};`,
      opIds: [op.id],
      warnings: [],
    });
  }
  // retypeColumn on existing-base column
  for (const op of ops) {
    if (op.kind !== "retypeColumn") continue;
    if ("_newCol" in op.column) continue;
    const ref = op.column;
    if ("_newCol" in ref) continue;
    const tableSchema = (ref.table as { schema: string; name: string }).schema;
    const tableName = (ref.table as { schema: string; name: string }).name;
    stmts.push({
      sql: `ALTER TABLE ${q(tableSchema)}.${q(tableName)} ALTER COLUMN ${q(ref.column)} TYPE ${op.newDataType};`,
      opIds: [op.id],
      warnings: [],
    });
    // emit nullability change as separate stmt if it differs from base
    const baseCol = base.tables
      .find((t) => t.schema === tableSchema && t.name === tableName)
      ?.columns.find((c) => c.name === ref.column);
    if (baseCol && baseCol.nullable !== op.newNullable) {
      stmts.push({
        sql: `ALTER TABLE ${q(tableSchema)}.${q(tableName)} ${op.newNullable ? `ALTER COLUMN ${q(ref.column)} DROP NOT NULL` : `ALTER COLUMN ${q(ref.column)} SET NOT NULL`};`,
        opIds: [op.id],
        warnings: [],
      });
    }
  }

  // ---- Group C: ALTER ADD CONSTRAINT for non-self-contained FKs ----------------
  for (const op of ops) {
    if (op.kind !== "addFk") continue;
    if (isFkSelfContained(op, undefined, ops) === true) {
      // already inlined in CREATE
      const tableOpId = newTableOpIdForColumnRef(op.sourceColumns[0], ops);
      if (tableOpId !== undefined) continue;
    }
    const srcTableSchemaName = resolveTableSchemaName(op.sourceColumns[0], ops, newTableFinalName);
    const srcCols = op.sourceColumns.map((c) => columnFinalName(c, ops, newColFinalName));
    const tgt = resolveTableSchemaName(op.targetColumns[0], ops, newTableFinalName);
    const tgtCols = op.targetColumns.map((c) => columnFinalName(c, ops, newColFinalName));
    stmts.push({
      sql: `ALTER TABLE ${q(srcTableSchemaName.schema)}.${q(srcTableSchemaName.name)} ADD CONSTRAINT ${q(op.constraintName)} FOREIGN KEY (${srcCols.map(q).join(", ")}) REFERENCES ${q(tgt.schema)}.${q(tgt.name)} (${tgtCols.map(q).join(", ")});`,
      opIds: [op.id],
      warnings: [],
    });
  }

  // ---- Group D (S20): destructive + missing-constraint ops --------------------
  for (const op of ops) {
    if (op.kind === "dropTable") {
      stmts.push({
        sql: `DROP TABLE ${q(op.table.schema)}.${q(op.table.name)};`,
        opIds: [op.id],
        warnings: [],
      });
    } else if (op.kind === "dropColumn") {
      const tbl = resolveTableSchemaName(
        { table: op.column.table, column: "_dropColumn" } as ColumnRef,
        ops,
        newTableFinalName,
      );
      const colName = columnFinalName(op.column, ops, newColFinalName);
      stmts.push({
        sql: `ALTER TABLE ${q(tbl.schema)}.${q(tbl.name)} DROP COLUMN ${q(colName)};`,
        opIds: [op.id],
        warnings: [],
      });
    } else if (op.kind === "dropFk") {
      const tbl = isNewTableRef(op.table)
        ? (newTableFinalName.get(op.table._new) ?? { schema: "?", name: "?" })
        : op.table;
      stmts.push({
        sql: `ALTER TABLE ${q(tbl.schema)}.${q(tbl.name)} DROP CONSTRAINT ${q(op.constraintName)};`,
        opIds: [op.id],
        warnings: [],
      });
    } else if (op.kind === "setColumnNullable") {
      const tbl = resolveTableSchemaName(
        { table: op.column.table, column: "_setNullable" } as ColumnRef,
        ops,
        newTableFinalName,
      );
      const colName = columnFinalName(op.column, ops, newColFinalName);
      const action = op.nullable ? "DROP NOT NULL" : "SET NOT NULL";
      stmts.push({
        sql: `ALTER TABLE ${q(tbl.schema)}.${q(tbl.name)} ALTER COLUMN ${q(colName)} ${action};`,
        opIds: [op.id],
        warnings: [],
      });
    } else if (op.kind === "addPrimaryKey") {
      const tbl = isNewTableRef(op.table)
        ? (newTableFinalName.get(op.table._new) ?? { schema: "?", name: "?" })
        : op.table;
      const cols = op.columns.map((c) => q(c)).join(", ");
      stmts.push({
        sql: `ALTER TABLE ${q(tbl.schema)}.${q(tbl.name)} ADD PRIMARY KEY (${cols});`,
        opIds: [op.id],
        warnings: [],
      });
    }
  }

  return {
    sql: stmts.map((s) => s.sql).join("\n\n"),
    statements: stmts,
  };
}

// --- helpers ---

function q(ident: string): string {
  return `"${ident.replace(/"/g, `""`)}"`;
}

function emitColumnDef(final: {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  identity: boolean;
}): string {
  const parts: string[] = [q(final.name), final.dataType];
  if (final.identity) parts.push("GENERATED ALWAYS AS IDENTITY");
  if (final.isPrimaryKey) parts.push("PRIMARY KEY");
  if (!final.nullable && !final.isPrimaryKey) parts.push("NOT NULL");
  return parts.join(" ");
}

function isNewTableRef(ref: AnyTableRef): ref is { _new: OpId } {
  return "_new" in ref;
}

function isFkSelfContained(
  fk: Extract<Op, { kind: "addFk" }>,
  candidateNewTableOpId: OpId | undefined,
  ops: Op[],
): boolean {
  // Self-contained means: every column ref's table is a NewTableRef.
  const isNewSide = (cr: ColumnRef): boolean => isNewTableRef(cr.table);
  const allNew = fk.sourceColumns.every(isNewSide) && fk.targetColumns.every(isNewSide);
  if (!allNew) return false;
  if (candidateNewTableOpId === undefined) return true;
  // For inline emit decision we restrict to same-source-table case.
  return newTableOpIdForColumnRef(fk.sourceColumns[0], ops) === candidateNewTableOpId;
}

function newTableOpIdForColumnRef(cr: ColumnRef, _ops: Op[]): OpId | undefined {
  return isNewTableRef(cr.table) ? cr.table._new : undefined;
}

function emitInlineFk(
  fk: Extract<Op, { kind: "addFk" }>,
  newColFinalName: Map<
    OpId,
    { name: string; dataType: string; nullable: boolean; isPrimaryKey: boolean; identity: boolean }
  >,
  newTableFinalName: Map<OpId, { schema: string; name: string }>,
  _base: ErdSchemaGraph,
): string {
  const srcCols = fk.sourceColumns.map((c) => columnFinalNameInline(c, newColFinalName));
  const tgtTable = isNewTableRef(fk.targetColumns[0].table)
    ? newTableFinalName.get(fk.targetColumns[0].table._new)!
    : {
        schema: (fk.targetColumns[0].table as { schema: string; name: string }).schema,
        name: (fk.targetColumns[0].table as { schema: string; name: string }).name,
      };
  const tgtCols: string[] = fk.targetColumns.map((c) => {
    if ("_newCol" in c) return newColFinalName.get(c._newCol)?.name ?? "";
    return c.column;
  });
  return `CONSTRAINT ${q(fk.constraintName)} FOREIGN KEY (${srcCols.map(q).join(", ")}) REFERENCES ${q(tgtTable.schema)}.${q(tgtTable.name)} (${tgtCols.map(q).join(", ")})`;
}

function columnFinalNameInline(
  cr: ColumnRef,
  newColFinalName: Map<
    OpId,
    { name: string; dataType: string; nullable: boolean; isPrimaryKey: boolean; identity: boolean }
  >,
): string {
  if ("_newCol" in cr) return newColFinalName.get(cr._newCol)?.name ?? "";
  return cr.column;
}

function columnFinalName(
  cr: ColumnRef,
  ops: Op[],
  newColFinalName: Map<
    OpId,
    { name: string; dataType: string; nullable: boolean; isPrimaryKey: boolean; identity: boolean }
  >,
): string {
  if ("_newCol" in cr) return newColFinalName.get(cr._newCol)?.name ?? "";
  // existing column ref — apply any renameColumn ops on the same (table, original name)
  let name = cr.column;
  if ("_new" in cr.table) return name;
  const crTableSchema = cr.table.schema;
  const crTableName = cr.table.name;
  const crColumn = cr.column;
  for (const op of ops) {
    if (
      op.kind === "renameColumn" &&
      !("_newCol" in op.column) &&
      !("_new" in op.column.table) &&
      op.column.table.schema === crTableSchema &&
      op.column.table.name === crTableName &&
      op.column.column === crColumn
    ) {
      name = op.newName;
    }
  }
  return name;
}

function resolveTableSchemaName(
  cr: ColumnRef,
  ops: Op[],
  newTableFinalName: Map<OpId, { schema: string; name: string }>,
): { schema: string; name: string } {
  if (isNewTableRef(cr.table)) {
    return newTableFinalName.get(cr.table._new) ?? { schema: "?", name: "?" };
  }
  // apply renameTable ops on existing TableRef
  const schema = cr.table.schema;
  let name = cr.table.name;
  for (const op of ops) {
    if (
      op.kind === "renameTable" &&
      !("_new" in op.table) &&
      op.table.schema === schema &&
      op.table.name === name
    ) {
      name = op.newName;
    }
  }
  return { schema, name };
}
