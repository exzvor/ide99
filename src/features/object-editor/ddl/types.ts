// — form-state types for the per-feature DDL generators.
//
// Each editor mounts a `*Form` shape. DDL generation is a pure function of
// `(initial: *Form | null, current: *Form) → DdlResult`. The `id` field on
// columns/constraints/indexes survives renames so diffing can detect
// "renamed" instead of emitting a destructive drop+add.

export type ColumnForm = {
  /** Stable UUID. New columns get a fresh id; introspect assigns ids when loading. */
  id: string;
  name: string;
  /** Raw type text — "TEXT", "VARCHAR(50)", "NUMERIC(10,2)". Generator uppercases. */
  typeText: string;
  nullable: boolean;
  /** Raw expression. null = no default. */
  default: string | null;
  /** PG12+ generated columns (STORED only — VIRTUAL not supported by Postgres yet). */
  generated: { kind: "stored"; expression: string } | null;
  comment: string | null;
};

export type ReferentialAction = "no_action" | "restrict" | "cascade" | "set_null" | "set_default";

export type ConstraintForm =
  | { id: string; kind: "pk"; columns: string[] }
  | { id: string; kind: "unique"; name?: string; columns: string[] }
  | {
      id: string;
      kind: "fk";
      name?: string;
      columns: string[];
      refSchema: string;
      refTable: string;
      refColumns: string[];
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
    }
  | { id: string; kind: "check"; name?: string; expression: string };

export type IndexColumnForm = {
  expr: string;
  direction?: "asc" | "desc";
  nulls?: "first" | "last";
  opclass?: string;
};

export type IndexForm = {
  id: string;
  name: string;
  schema: string;
  table: string;
  method: "btree" | "hash" | "gin" | "gist" | "brin" | "spgist" | "hnsw" | "ivfflat";
  unique: boolean;
  columns: IndexColumnForm[];
  /** INCLUDE (col, …) — non-key columns. */
  include: string[];
  /** Partial-index WHERE predicate — null = unfiltered. */
  predicate: string | null;
  /**
   * S26 — method-specific options emitted as `WITH (k = v, …)`.
   * Only populated for hnsw / ivfflat (m, ef_construction, lists). Older
   * methods pass `{}` and the WITH clause is omitted.
   */
  withOptions: Record<string, number>;
};

/** RLS policies — stub shape until v1.0 polish. S23 only toggles `enabled`. */
export type RlsPolicyStub = { id: string; placeholder: true };

/** Read-only partition info — S23 displays, doesn't edit. */
export type PartitionStub = {
  strategy: "range" | "list" | "hash";
  /** `pg_get_partkeydef` body, e.g. "RANGE (created_at)". */
  key: string;
};

export type TableForm = {
  schema: string;
  name: string;
  comment: string | null;
  columns: ColumnForm[];
  constraints: ConstraintForm[];
  indexes: IndexForm[];
  rls: { enabled: boolean; policies: RlsPolicyStub[] };
  partition: PartitionStub | null;
};

export type ViewForm = {
  schema: string;
  name: string;
  body: string;
};

export type MatviewForm = ViewForm & {
  /** Controls WITH DATA / WITH NO DATA in CREATE MATERIALIZED VIEW. */
  withData: boolean;
};

export type SequenceForm = {
  schema: string;
  name: string;
  dataType: "smallint" | "integer" | "bigint";
  /** null = use Postgres default (1 for ascending, max for descending). */
  start: number | null;
  increment: number;
  minValue: number | null;
  maxValue: number | null;
  cache: number;
  cycle: boolean;
  ownedBy: { schema: string; table: string; column: string } | null;
};

export type DdlWarning = { code: string; message: string };
export type DdlError = { code: string; message: string };
export type DdlResult = {
  /** Newline-separated SQL chunks. Empty string when there are no changes
   * (UI shows a placeholder instead). NEVER wrapped in BEGIN/COMMIT —
   * backend `schema_apply_ddl` wraps the whole string in a single tx. */
  sql: string;
  warnings: DdlWarning[];
  errors: DdlError[];
};

// ---------------------------------------------------------------------------
// — function / procedure / trigger form types.
// ---------------------------------------------------------------------------

export type Volatility = "volatile" | "stable" | "immutable";
export type ParallelSafety = "unsafe" | "restricted" | "safe";
export type ParameterMode = "in" | "out" | "inout" | "variadic";
export type FunctionLanguage = "sql" | "plpgsql" | "other";
export type ReturnKind = "scalar" | "setof" | "trigger" | "void";

export type FunctionParameter = {
  /** UUID — diff-stable identity across rename. */
  id: string;
  name: string;
  mode: ParameterMode;
  type: string;
  default: string | null;
};

export type FunctionForm = {
  schema: string;
  name: string;
  language: FunctionLanguage;
  /** Set when language === "other" — e.g. "plpython3u". */
  languageOther?: string;
  parameters: FunctionParameter[];
  returnKind: ReturnKind;
  returnType?: string;
  body: string;
  volatility: Volatility;
  parallelSafety: ParallelSafety;
  securityDefiner: boolean;
  /** null = use Postgres default (100). */
  cost: number | null;
  /** Setof only; null = unset. */
  estimatedRows: number | null;
  comment: string | null;
};

export type ProcedureForm = {
  schema: string;
  name: string;
  language: FunctionLanguage;
  languageOther?: string;
  parameters: FunctionParameter[];
  body: string;
  securityDefiner: boolean;
  comment: string | null;
};

export type TriggerEventsForm = {
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
};

export type TriggerForm = {
  schema: string;
  name: string;
  table: { schema: string; name: string };
  timing: "before" | "after" | "instead_of";
  events: TriggerEventsForm;
  /** UPDATE OF (...) — empty array means all columns. */
  updateColumns: string[];
  forEach: "row" | "statement";
  whenClause: string | null;
  functionRef: { schema: string; name: string };
  enabled: boolean;
};

// ---------------------------------------------------------------------------
// — FDW / Publication / Subscription / Role / Custom Type forms.
// ---------------------------------------------------------------------------

export type QualifiedNameForm = { id: string; schema: string; name: string };

export type KvOptionForm = { id: string; key: string; value: string };

export type UserMappingForm = {
  id: string;
  roleName: string;
  options: KvOptionForm[];
};

export type FdwServerForm = {
  name: string;
  fdwName: string;
  serverType?: string;
  version?: string;
  options: KvOptionForm[];
  userMappings: UserMappingForm[];
  comment: string | null;
};

export type PublicationMode = "all_tables" | "schemas" | "tables";

export type PublicationForm = {
  name: string;
  mode: PublicationMode;
  schemas: string[];
  tables: QualifiedNameForm[];
  publishInsert: boolean;
  publishUpdate: boolean;
  publishDelete: boolean;
  publishTruncate: boolean;
  publishViaPartitionRoot: boolean;
  comment: string | null;
};

export type SubscriptionForm = {
  name: string;
  conninfo: string;
  publications: string[];
  enabled: boolean;
  copyData: boolean;
  createSlot: boolean;
  slotName?: string;
  synchronousCommit?: string;
  comment: string | null;
};

export type RoleForm = {
  name: string;
  login: boolean;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  replication: boolean;
  bypassrls: boolean;
  inherit: boolean;
  /** -1 = no limit. */
  connectionLimit: number;
  validUntil?: string;
  password?: string;
  passwordIsHash: boolean;
  memberOf: string[];
  comment: string | null;
};

export type EnumValueForm = { id: string; value: string };

export type EnumTypeForm = {
  schema: string;
  name: string;
  values: EnumValueForm[];
  comment: string | null;
};

export type CompositeFieldForm = {
  id: string;
  fieldName: string;
  typeText: string;
  collation?: string;
};

export type CompositeTypeForm = {
  schema: string;
  name: string;
  fields: CompositeFieldForm[];
  comment: string | null;
};

export type DomainConstraintForm = {
  id: string;
  constraintName?: string;
  checkExpression: string;
  notValid: boolean;
  /** True when added in the editor (vs loaded from PG). */
  isNew: boolean;
};

export type DomainTypeForm = {
  schema: string;
  name: string;
  baseType: string;
  notNull: boolean;
  default?: string;
  collation?: string;
  constraints: DomainConstraintForm[];
  comment: string | null;
};

export type RangeTypeForm = {
  schema: string;
  name: string;
  subtype: string;
  subtypeOpclass?: string;
  collation?: string;
  canonical?: string;
  subtypeDiff?: string;
  multirangeTypeName?: string;
  comment: string | null;
};
