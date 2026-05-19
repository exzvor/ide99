// src/features/erd/edit/types.ts
import type { ErdSchemaGraph } from "../../../lib/tauri";
import type { AnyTableRef, Op, OpId } from "./ops";

/** Working graph = base + applied ops, what Canvas renders in edit mode. */
export interface WorkingErdGraph {
  tables: WorkingTable[];
  fks: WorkingFk[];
  /** OpIds of `addTable` ops contributing tables in this graph (used for
   * "is this new this session?" affordances in TableCard). */
  newTableOpIds: Set<OpId>;
}

export interface WorkingTable {
  /** Stable id within working graph: either `${schema}.${name}` (existing) or
   * `_new:${addTableOpId}` (new this session). */
  id: string;
  schema: string;
  name: string;
  /** Tracks the original-in-base name when renamed; undefined if not renamed
   * or if added-this-session. ddlGen consults this when emitting RENAME. */
  originalName?: string;
  columns: WorkingColumn[];
  /** Reference back to addTable.id for new tables. Undefined for existing. */
  addOpId?: OpId;
}

export interface WorkingColumn {
  /** Same id-stable convention: original column name (existing) or
   * `_new:${opId}` (new this session — addColumn.id or seedColumn.opId). */
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  identity: boolean; // emit `GENERATED ALWAYS AS IDENTITY` if true
  isForeignKey: boolean; // derived from working FKs touching this column
  /** Same role as WorkingTable.originalName. */
  originalName?: string;
  originalDataType?: string;
  originalNullable?: boolean;
  /** opId of addColumn / seedColumn that created this; undefined for existing. */
  addOpId?: OpId;
}

export interface WorkingFk {
  /** Synthetic stable id (constraint name + opId for new). */
  id: string;
  name: string;
  source: { tableId: string; columnIds: string[] };
  target: { tableId: string; columnIds: string[] };
  /** OpId of addFk for new FKs; undefined for existing-in-base FKs. */
  addOpId?: OpId;
}

/** Output of `generateDdl`. */
export interface DdlStatement {
  sql: string;
  /** Op-ids that contributed to this statement; UI uses this to highlight
   * canvas elements when user hovers over a preview line. */
  opIds: OpId[];
  warnings: string[];
}

export interface DdlGenResult {
  sql: string; // full script joined by ";\n\n"
  statements: DdlStatement[];
}

/** Output of `validateOps`. Issues are surfaced inline on offending op
 * targets; severity gates Apply. */
export type ValidationIssue =
  | { kind: "empty-name"; opId: OpId; field: "table" | "column" | "constraint"; severity: "error" }
  | { kind: "duplicate-table"; opId: OpId; schema: string; name: string; severity: "error" }
  | {
      kind: "duplicate-column";
      opId: OpId;
      tableRef: AnyTableRef;
      column: string;
      severity: "error";
    }
  | { kind: "no-columns"; opId: OpId; severity: "error" }
  | {
      kind: "fk-type-mismatch";
      opId: OpId;
      sourceType: string;
      targetType: string;
      severity: "warning";
    }
  | { kind: "fk-target-not-unique"; opId: OpId; severity: "warning" };

export type ValidationSeverity = "error" | "warning";

// Re-exports kept for convenience (used by Op consumers that don't import from ops directly).
export type { ErdSchemaGraph, Op };
