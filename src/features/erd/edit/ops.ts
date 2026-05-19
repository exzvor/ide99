import { z } from "zod";

export type OpId = string;

export function newOpId(): OpId {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `op-${Math.random().toString(36).slice(2, 12)}`;
}

// ---- refs ----

export const tableRefSchema = z.object({
  schema: z.string(),
  name: z.string(),
});
export type TableRef = z.infer<typeof tableRefSchema>;

export const newTableRefSchema = z.object({ _new: z.string() });
export type NewTableRef = z.infer<typeof newTableRefSchema>;

export const anyTableRefSchema = z.union([tableRefSchema, newTableRefSchema]);
export type AnyTableRef = z.infer<typeof anyTableRefSchema>;

export const columnRefSchema = z.union([
  z.object({ table: anyTableRefSchema, column: z.string() }),
  z.object({ table: anyTableRefSchema, _newCol: z.string() }),
]);
export type ColumnRef = z.infer<typeof columnRefSchema>;

// ---- seed column ----

export const seedColumnSchema = z.object({
  opId: z.string(),
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  identity: z.boolean(),
  primaryKey: z.boolean(),
});
export type SeedColumn = z.infer<typeof seedColumnSchema>;

// ---- ops ----

export const addTableOpSchema = z.object({
  kind: z.literal("addTable"),
  id: z.string(),
  schema: z.string(),
  name: z.string(),
  seedColumns: z.array(seedColumnSchema),
});
export const addColumnOpSchema = z.object({
  kind: z.literal("addColumn"),
  id: z.string(),
  table: anyTableRefSchema,
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
});
export const renameTableOpSchema = z.object({
  kind: z.literal("renameTable"),
  id: z.string(),
  table: anyTableRefSchema,
  newName: z.string(),
});
export const renameColumnOpSchema = z.object({
  kind: z.literal("renameColumn"),
  id: z.string(),
  column: columnRefSchema,
  newName: z.string(),
});
export const retypeColumnOpSchema = z.object({
  kind: z.literal("retypeColumn"),
  id: z.string(),
  column: columnRefSchema,
  newDataType: z.string(),
  newNullable: z.boolean(),
});
export const addFkOpSchema = z.object({
  kind: z.literal("addFk"),
  id: z.string(),
  sourceColumns: z.array(columnRefSchema).min(1),
  targetColumns: z.array(columnRefSchema).min(1),
  constraintName: z.string(),
});
export const moveTableOpSchema = z.object({
  kind: z.literal("moveTable"),
  id: z.string(),
  table: anyTableRefSchema,
  x: z.number(),
  y: z.number(),
});

// ---- S20: destructive + missing constraint ops ----------------------------
//
// These exist so the AST → Op[] reverse-mapper (applyAstChanges) can project
// arbitrary DDL edits back into the canonical op log. S19 only shipped the
// additive subset.

export const dropTableOpSchema = z.object({
  kind: z.literal("dropTable"),
  id: z.string(),
  // Existing tables only — _new tables aren't dropped (they just don't get added).
  table: tableRefSchema,
});
export const dropColumnOpSchema = z.object({
  kind: z.literal("dropColumn"),
  id: z.string(),
  column: columnRefSchema,
});
export const dropFkOpSchema = z.object({
  kind: z.literal("dropFk"),
  id: z.string(),
  table: anyTableRefSchema,
  constraintName: z.string(),
});
export const setColumnNullableOpSchema = z.object({
  kind: z.literal("setColumnNullable"),
  id: z.string(),
  column: columnRefSchema,
  nullable: z.boolean(),
});
export const addPrimaryKeyOpSchema = z.object({
  kind: z.literal("addPrimaryKey"),
  id: z.string(),
  table: anyTableRefSchema,
  columns: z.array(z.string()).min(1),
});

export const opSchema = z.discriminatedUnion("kind", [
  addTableOpSchema,
  addColumnOpSchema,
  renameTableOpSchema,
  renameColumnOpSchema,
  retypeColumnOpSchema,
  addFkOpSchema,
  moveTableOpSchema,
  dropTableOpSchema,
  dropColumnOpSchema,
  dropFkOpSchema,
  setColumnNullableOpSchema,
  addPrimaryKeyOpSchema,
]);
export type Op = z.infer<typeof opSchema>;

// ---- factories ----

export function makeAddTableOp(  schema: string,
  name: string,
  seedColumns?: SeedColumn[],
): z.infer<typeof addTableOpSchema> {
  const defaultSeed: SeedColumn[] = [
    {
      opId: newOpId(),
      name: "id",
      dataType: "BIGINT",
      nullable: false,
      identity: true,
      primaryKey: true,
    },
  ];
  return {
    kind: "addTable",
    id: newOpId(),
    schema,
    name,
    seedColumns: seedColumns ?? defaultSeed,
  };
}

export function makeAddColumnOp(  table: AnyTableRef,
  name: string,
  dataType: string,
  nullable: boolean,
  isPrimaryKey: boolean,
): z.infer<typeof addColumnOpSchema> {
  return { kind: "addColumn", id: newOpId(), table, name, dataType, nullable, isPrimaryKey };
}

export function makeRenameTableOp(  table: TableRef | NewTableRef,
  newName: string,
): z.infer<typeof renameTableOpSchema> {
  return { kind: "renameTable", id: newOpId(), table, newName };
}

export function makeRenameColumnOp(  column: ColumnRef,
  newName: string,
): z.infer<typeof renameColumnOpSchema> {
  return { kind: "renameColumn", id: newOpId(), column, newName };
}

export function makeRetypeColumnOp(  column: ColumnRef,
  newDataType: string,
  newNullable: boolean,
): z.infer<typeof retypeColumnOpSchema> {
  return { kind: "retypeColumn", id: newOpId(), column, newDataType, newNullable };
}

export function makeAddFkOp(  sourceColumns: ColumnRef[],
  targetColumns: ColumnRef[],
  constraintName: string,
): z.infer<typeof addFkOpSchema> {
  return { kind: "addFk", id: newOpId(), sourceColumns, targetColumns, constraintName };
}

export function makeMoveTableOp(  table: AnyTableRef,
  x: number,
  y: number,
): z.infer<typeof moveTableOpSchema> {
  return { kind: "moveTable", id: newOpId(), table, x, y };
}

export function makeDropTableOp(table: TableRef): z.infer<typeof dropTableOpSchema> {
  return { kind: "dropTable", id: newOpId(), table };
}

export function makeDropColumnOp(column: ColumnRef): z.infer<typeof dropColumnOpSchema> {
  return { kind: "dropColumn", id: newOpId(), column };
}

export function makeDropFkOp(  table: AnyTableRef,
  constraintName: string,
): z.infer<typeof dropFkOpSchema> {
  return { kind: "dropFk", id: newOpId(), table, constraintName };
}

export function makeSetColumnNullableOp(  column: ColumnRef,
  nullable: boolean,
): z.infer<typeof setColumnNullableOpSchema> {
  return { kind: "setColumnNullable", id: newOpId(), column, nullable };
}

export function makeAddPrimaryKeyOp(  table: AnyTableRef,
  columns: string[],
): z.infer<typeof addPrimaryKeyOpSchema> {
  return { kind: "addPrimaryKey", id: newOpId(), table, columns };
}
