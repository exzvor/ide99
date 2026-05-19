// src/lib/parser.ts
//
// Typed wrappers around the `parser_parse_ddl` and `parser_parse_select`
// Tauri commands. Runtime validation is performed via Zod against the
// camelCased JSON shapes serialized from `src-tauri/src/parser/types.rs`.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const filterOpSchema = z.enum([
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "like",
  "isNull",
  "isNotNull",
]);
export type FilterOp = z.infer<typeof filterOpSchema>;

export const filterSchema = z.object({
  column: z.string(),
  op: filterOpSchema,
  value: z.any().nullable().optional(),
});
export type Filter = z.infer<typeof filterSchema>;

export const sortDirSchema = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof sortDirSchema>;

export const sortSchema = z.object({ column: z.string(), dir: sortDirSchema });
export type Sort = z.infer<typeof sortSchema>;

export const clauseSpanSchema = z.object({
  start: z.number(),
  end: z.number(),
});
export type ClauseSpan = z.infer<typeof clauseSpanSchema>;

export const baseSelectSchema = z.object({
  schema: z.string().nullable(),
  table: z.string(),
  columns: z.array(z.string()),
});
export type BaseSelect = z.infer<typeof baseSelectSchema>;

export const queryShapeSchema = z.object({
  baseSelect: baseSelectSchema,
  filters: z.array(filterSchema),
  sort: sortSchema.nullable(),
  limit: z.number().nullable(),
  unrepresentableTail: z.string().nullable(),
  whereSpan: clauseSpanSchema.nullable(),
  orderBySpan: clauseSpanSchema.nullable(),
  limitSpan: clauseSpanSchema.nullable(),
  fromEnd: z.number(),
});
export type QueryShape = z.infer<typeof queryShapeSchema>;

export const columnDefSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  identity: z.boolean(),
  isPrimaryKey: z.boolean(),
});
export type ColumnDef = z.infer<typeof columnDefSchema>;

export const ddlChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("createTable"),
    schema: z.string(),
    name: z.string(),
    columns: z.array(columnDefSchema),
    primaryKey: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("dropTable"),
    schema: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal("renameTable"),
    schema: z.string(),
    oldName: z.string(),
    newName: z.string(),
  }),
  z.object({
    kind: z.literal("addColumn"),
    schema: z.string(),
    table: z.string(),
    column: columnDefSchema,
  }),
  z.object({
    kind: z.literal("dropColumn"),
    schema: z.string(),
    table: z.string(),
    column: z.string(),
  }),
  z.object({
    kind: z.literal("renameColumn"),
    schema: z.string(),
    table: z.string(),
    oldName: z.string(),
    newName: z.string(),
  }),
  z.object({
    kind: z.literal("alterColumnType"),
    schema: z.string(),
    table: z.string(),
    column: z.string(),
    newType: z.string(),
  }),
  z.object({
    kind: z.literal("alterColumnNullable"),
    schema: z.string(),
    table: z.string(),
    column: z.string(),
    nullable: z.boolean(),
  }),
  z.object({
    kind: z.literal("addPrimaryKey"),
    schema: z.string(),
    table: z.string(),
    columns: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("addForeignKey"),
    schema: z.string(),
    table: z.string(),
    name: z.string().nullable(),
    columns: z.array(z.string()),
    refSchema: z.string(),
    refTable: z.string(),
    refColumns: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("dropConstraint"),
    schema: z.string(),
    table: z.string(),
    constraint: z.string(),
  }),
  z.object({
    kind: z.literal("unrepresentable"),
    sqlSnippet: z.string(),
    reason: z.string(),
  }),
]);
export type DdlChange = z.infer<typeof ddlChangeSchema>;

export const ddlParseResultSchema = z.object({
  changes: z.array(ddlChangeSchema),
  warnings: z.array(z.string()),
});
export type DdlParseResult = z.infer<typeof ddlParseResultSchema>;

export const parseErrorSchema = z.object({
  message: z.string(),
  line: z.number(),
  column: z.number(),
});
export type ParseError = z.infer<typeof parseErrorSchema>;

export type ParseDdlResult = { ok: true; value: DdlParseResult } | { ok: false; error: ParseError };

export type ParseSelectResult = { ok: true; value: QueryShape } | { ok: false; error: ParseError };

export async function parseDdl(text: string): Promise<ParseDdlResult> {
  try {
    const raw = await invoke<unknown>("parser_parse_ddl", { text });
    return { ok: true, value: ddlParseResultSchema.parse(raw) };
  } catch (err) {
    return { ok: false, error: parseErrorSchema.parse(err) };
  }
}

export async function parseSelect(text: string): Promise<ParseSelectResult> {
  try {
    const raw = await invoke<unknown>("parser_parse_select", { text });
    return { ok: true, value: queryShapeSchema.parse(raw) };
  } catch (err) {
    return { ok: false, error: parseErrorSchema.parse(err) };
  }
}
