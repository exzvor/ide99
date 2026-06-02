/**
 * Typed wrappers around `@tauri-apps/api/core`'s `invoke()` for every
 * connection-manager command. Single source of truth between Rust DTOs
 * (in `src-tauri/src/connection/types.rs`) and TypeScript consumers.
 *
 * Runtime validation via zod guards against schema drift between Rust + TS.
 */

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { z } from "zod";

// ---------- enums ----------

export const sslModeSchema = z.enum([
  "disable",
  "allow",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
]);
export type SslMode = z.infer<typeof sslModeSchema>;

export const environmentSchema = z.enum(["local", "dev", "stage", "prod"]);
export type Environment = z.infer<typeof environmentSchema>;

// ---------- DTOs ----------

export const connectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  database: z.string(),
  username: z.string(),
  sslMode: sslModeSchema,
  hasPassword: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTestedAt: z.string().nullable(),
  lastTestOk: z.boolean().nullable(),
  excludeFromHistory: z.boolean(),
  excludeFromRecentPlans: z.boolean(),
  environment: environmentSchema,
  readOnly: z.boolean(),
  slowQueryWarning: z.boolean(),
  confirmDestructive: z.boolean(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const newConnectionSchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  database: z.string(),
  username: z.string(),
  password: z.string().optional(),
  sslMode: sslModeSchema,
  excludeFromHistory: z.boolean().default(false),
  excludeFromRecentPlans: z.boolean().default(false),
  environment: environmentSchema.default("local"),
  readOnly: z.boolean().default(false),
  slowQueryWarning: z.boolean().default(false),
  confirmDestructive: z.boolean().default(false),
});
export type NewConnection = z.infer<typeof newConnectionSchema>;

export const updatePasswordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep") }),
  z.object({ kind: z.literal("set"), value: z.string() }),
  z.object({ kind: z.literal("clear") }),
]);
export type UpdatePassword = z.infer<typeof updatePasswordSchema>;

export const updateConnectionSchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  database: z.string(),
  username: z.string(),
  password: updatePasswordSchema,
  sslMode: sslModeSchema,
  excludeFromHistory: z.boolean().default(false),
  excludeFromRecentPlans: z.boolean().default(false),
  environment: environmentSchema.default("local"),
  readOnly: z.boolean().default(false),
  slowQueryWarning: z.boolean().default(false),
  confirmDestructive: z.boolean().default(false),
});
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;

export const testInputSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  database: z.string(),
  username: z.string(),
  password: z.string().optional(),
  sslMode: sslModeSchema,
});
export type TestInput = z.infer<typeof testInputSchema>;

export const testResultSchema = z.object({
  ok: z.boolean(),
  durationMs: z.number().nonnegative(),
  error: z.string().nullable(),
  serverVersion: z.string().nullable(),
});
export type TestResult = z.infer<typeof testResultSchema>;

export const parsedUriSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  database: z.string(),
  username: z.string(),
  password: z.string().optional().nullable(),
  sslMode: sslModeSchema,
});
export type ParsedUri = z.infer<typeof parsedUriSchema>;

// ---------- error envelope ----------

export const connectionErrorSchema = z.object({
  kind: z.enum([
    "notFound",
    "duplicateName",
    "invalidInput",
    "invalidUri",
    "storage",
    "keychain",
    "passwordMissing",
    "postgres",
    "notConnected",
    "io",
  ]),
  message: z.string(),
});
export type ConnectionErrorPayload = z.infer<typeof connectionErrorSchema>;

export class ConnectionError extends Error {
  readonly kind: ConnectionErrorPayload["kind"];
  constructor(payload: ConnectionErrorPayload) {
    super(payload.message);
    this.name = "ConnectionError";
    this.kind = payload.kind;
  }
}

// ---------------- — Health Screen ----------------

export const cardErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("unavailable"),
    extension: z.string(),
    installSql: z.string(),
  }),
  z.object({
    kind: z.literal("forbidden"),
    requiredRole: z.string(),
  }),
  z.object({
    kind: z.literal("queryFailed"),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("notConnected"),
  }),
]);
export type CardError = z.infer<typeof cardErrorSchema>;

export type CardResult<T> = { ok: true; data: T } | { ok: false; error: CardError };

export const dbSizeDataSchema = z.object({
  bytes: z.number().int(),
  pretty: z.string(),
  growth7dBytes: z.number().int().nullable(),
  growth7dPct: z.number().nullable(),
  sparklinePoints: z.array(z.number().int()),
});
export type DbSizeData = z.infer<typeof dbSizeDataSchema>;

export const bloatRowSchema = z.object({
  schema: z.string(),
  table: z.string(),
  bloatPct: z.number(),
  bloatBytes: z.number().int(),
});
export const bloatTopDataSchema = z.object({ rows: z.array(bloatRowSchema) });
export type BloatTopData = z.infer<typeof bloatTopDataSchema>;

export const slowQueryRowSchema = z.object({
  query: z.string(),
  meanTimeMs: z.number(),
  totalTimeMs: z.number(),
  calls: z.number().int(),
});
export const slowQueriesDataSchema = z.object({ rows: z.array(slowQueryRowSchema) });
export type SlowQueriesData = z.infer<typeof slowQueriesDataSchema>;

export const missingIndexRowSchema = z.object({
  schema: z.string(),
  table: z.string(),
  seqScan: z.number().int(),
  seqTupRead: z.number().int(),
  indexScan: z.number().int(),
});
export const missingIndexesDataSchema = z.object({ rows: z.array(missingIndexRowSchema) });
export type MissingIndexesData = z.infer<typeof missingIndexesDataSchema>;

export const unusedIndexRowSchema = z.object({
  schema: z.string(),
  index: z.string(),
  onTable: z.string(),
  sizeBytes: z.number().int(),
});
export const unusedIndexesDataSchema = z.object({ rows: z.array(unusedIndexRowSchema) });
export type UnusedIndexesData = z.infer<typeof unusedIndexesDataSchema>;

export const cacheHitDataSchema = z.object({ ratioPct: z.number() });
export type CacheHitData = z.infer<typeof cacheHitDataSchema>;

export const activeConnectionsDataSchema = z.object({
  current: z.number().int(),
  max: z.number().int(),
  byState: z.record(z.number().int()),
});
export type ActiveConnectionsData = z.infer<typeof activeConnectionsDataSchema>;

export const longQueryRowSchema = z.object({
  pid: z.number().int(),
  durationSeconds: z.number(),
  query: z.string(),
  state: z.string(),
  username: z.string(),
});
export const longRunningDataSchema = z.object({ rows: z.array(longQueryRowSchema) });
export type LongRunningData = z.infer<typeof longRunningDataSchema>;

export const vacuumRowSchema = z.object({
  schema: z.string(),
  table: z.string(),
  lastVacuum: z.string().nullable(),
  lastAutovacuum: z.string().nullable(),
  daysSince: z.number().int().nullable(),
});
export const vacuumStatusDataSchema = z.object({ rows: z.array(vacuumRowSchema) });
export type VacuumStatusData = z.infer<typeof vacuumStatusDataSchema>;

export const replicationStateSchema = z.enum(["no_replicas", "streaming", "lagging"]);
export type ReplicationStateValue = z.infer<typeof replicationStateSchema>;

export const replicationSlotRowSchema = z.object({
  slot: z.string(),
  lagBytes: z.number().int().nullable(),
  lagSeconds: z.number().nullable(),
  state: z.string(),
});
export const replicationLagDataSchema = z.object({
  state: replicationStateSchema,
  slots: z.array(replicationSlotRowSchema),
});
export type ReplicationLagData = z.infer<typeof replicationLagDataSchema>;

export const walThroughputDataSchema = z.object({
  bytesPerSec: z.number(),
  totalBytes: z.number().int(),
  secondsSinceReset: z.number(),
});
export type WalThroughputData = z.infer<typeof walThroughputDataSchema>;

export const healthSnapshotRowSchema = z.object({
  takenAt: z.string(),
  dbSizeBytes: z.number().int(),
});
export type HealthSnapshotRow = z.infer<typeof healthSnapshotRowSchema>;

async function invokeCardCommand<T>(
  cmd: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<CardResult<T>> {
  try {
    const raw = await invoke<unknown>(cmd, args);
    return { ok: true, data: schema.parse(raw) };
  } catch (e) {
    const parsed = cardErrorSchema.safeParse(e);
    if (parsed.success) return { ok: false, error: parsed.data };
    return {
      ok: false,
      error: { kind: "queryFailed", message: e instanceof Error ? e.message : String(e) },
    };
  }
}

export function healthDbSize(connId: string): Promise<CardResult<DbSizeData>> {
  return invokeCardCommand("health_db_size", { connId }, dbSizeDataSchema);
}
export function healthBloat(connId: string): Promise<CardResult<BloatTopData>> {
  return invokeCardCommand("health_bloat", { connId }, bloatTopDataSchema);
}
export function healthSlowQueries(connId: string): Promise<CardResult<SlowQueriesData>> {
  return invokeCardCommand("health_slow_queries", { connId }, slowQueriesDataSchema);
}
export function healthMissingIndexes(connId: string): Promise<CardResult<MissingIndexesData>> {
  return invokeCardCommand("health_missing_indexes", { connId }, missingIndexesDataSchema);
}
export function healthUnusedIndexes(connId: string): Promise<CardResult<UnusedIndexesData>> {
  return invokeCardCommand("health_unused_indexes", { connId }, unusedIndexesDataSchema);
}
export function healthCacheHit(connId: string): Promise<CardResult<CacheHitData>> {
  return invokeCardCommand("health_cache_hit", { connId }, cacheHitDataSchema);
}
export function healthActiveConnections(
  connId: string,
): Promise<CardResult<ActiveConnectionsData>> {
  return invokeCardCommand("health_active_connections", { connId }, activeConnectionsDataSchema);
}
export function healthLongRunning(connId: string): Promise<CardResult<LongRunningData>> {
  return invokeCardCommand("health_long_running", { connId }, longRunningDataSchema);
}
export function healthVacuumStatus(connId: string): Promise<CardResult<VacuumStatusData>> {
  return invokeCardCommand("health_vacuum_status", { connId }, vacuumStatusDataSchema);
}
export function healthReplicationLag(connId: string): Promise<CardResult<ReplicationLagData>> {
  return invokeCardCommand("health_replication_lag", { connId }, replicationLagDataSchema);
}
export function healthWalThroughput(connId: string): Promise<CardResult<WalThroughputData>> {
  return invokeCardCommand("health_wal_throughput", { connId }, walThroughputDataSchema);
}

export async function healthSnapshotsSave(connId: string, dbSizeBytes: number): Promise<void> {
  await invoke<unknown>("health_snapshots_save", { connId, dbSizeBytes });
}
export async function healthSnapshotsRecent(
  connId: string,
  days: number,
): Promise<HealthSnapshotRow[]> {
  const raw = await invoke<unknown>("health_snapshots_recent", { connId, days });
  return z.array(healthSnapshotRowSchema).parse(raw);
}

// ---------- wrappers ----------

/**
 * Accept-anything-empty schema for Tauri commands that return Rust `()`.
 * `tauri::invoke` resolves to `null` for unit returns, but `emptyResultSchema` only
 * matches `undefined` — so the natural `emptyResultSchema` choice rejects every
 * successful no-result call with a confusing zod error. This helper bridges
 * the gap.
 */
const emptyResultSchema = z
  .union([z.null(), z.undefined(), z.void()])
  .transform((): void => {}) as z.ZodSchema<void>;

async function invokeChecked<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  schema: z.ZodSchema<T>,
): Promise<T> {
  try {
    const raw = await invoke<unknown>(command, args);
    return schema.parse(raw);
  } catch (err) {
    if (err && typeof err === "object" && "kind" in err && "message" in err) {
      const payload = connectionErrorSchema.safeParse(err);
      if (payload.success) {
        throw new ConnectionError(payload.data);
      }
    }
    throw err;
  }
}

export function listConnections(): Promise<Connection[]> {
  return invokeChecked("list_connections", undefined, z.array(connectionSchema));
}

export function createConnection(input: NewConnection): Promise<Connection> {
  return invokeChecked("create_connection", { input }, connectionSchema);
}

export function duplicateConnection(id: string): Promise<Connection> {
  return invokeChecked("duplicate_connection", { id }, connectionSchema);
}

export function updateConnection(id: string, input: UpdateConnection): Promise<Connection> {
  return invokeChecked("update_connection", { id, input }, connectionSchema);
}

export function deleteConnection(id: string): Promise<void> {
  return invokeChecked("delete_connection", { id }, emptyResultSchema);
}

export function testConnection(input: TestInput): Promise<TestResult> {
  return invokeChecked("test_connection", { input }, testResultSchema);
}

/**
 * Edit-form variant — sends overrides + connection id; backend fills the
 * password from the keychain when the supplied `password` is undefined.
 */
export function testConnectionForEdit(id: string, input: TestInput): Promise<TestResult> {
  return invokeChecked("test_connection_for_edit", { id, input }, testResultSchema);
}

export function testSavedConnection(id: string): Promise<TestResult> {
  return invokeChecked("test_saved_connection", { id }, testResultSchema);
}

/**
 * List the databases reachable with the supplied free-form credentials.
 * Connects to a maintenance DB, so it works even if `input.database` is a typo.
 */
export function listDatabases(input: TestInput): Promise<string[]> {
  return invokeChecked("list_databases", { input }, z.array(z.string()));
}

/** Edit-form variant — backend fills the password from the keychain when blank. */
export function listDatabasesForEdit(id: string, input: TestInput): Promise<string[]> {
  return invokeChecked("list_databases_for_edit", { id, input }, z.array(z.string()));
}

/**
 * Persist a test result the form already obtained, without re-hitting
 * Postgres. Used right after Save to populate `lastTestedAt` /
 * `lastTestOk` on the freshly-saved row so the details card no longer
 * reads "Never tested" while the user just saw the green check
 * ().
 */
export function connectionRecordTestResult(id: string, ok: boolean): Promise<Connection> {
  return invokeChecked("connection_record_test_result", { id, ok }, connectionSchema);
}

export function parseConnectionUri(uri: string): Promise<ParsedUri> {
  return invokeChecked("parse_connection_uri", { uri }, parsedUriSchema);
}

// ---------- schema introspection ----------

export const connectInfoSchema = z.object({
  serverVersion: z.string(),
  database: z.string(),
});
export type ConnectInfo = z.infer<typeof connectInfoSchema>;

export const schemaInfoSchema = z.object({
  name: z.string(),
  owner: z.string().nullable(),
});
export type SchemaInfo = z.infer<typeof schemaInfoSchema>;

export const tableInfoSchema = z.object({
  name: z.string(),
  comment: z.string().nullable(),
});
export type TableInfo = z.infer<typeof tableInfoSchema>;

export const viewInfoSchema = z.object({
  name: z.string(),
  definition: z.string(),
  comment: z.string().nullable(),
});
export type ViewInfo = z.infer<typeof viewInfoSchema>;

export const columnInfoSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  comment: z.string().nullable(),
  ordinal: z.number().int(),
});
export type ColumnInfo = z.infer<typeof columnInfoSchema>;

export const indexInfoSchema = z.object({
  name: z.string(),
  method: z.string(),
  isUnique: z.boolean(),
  isPrimary: z.boolean(),
  definition: z.string(),
});
export type IndexInfo = z.infer<typeof indexInfoSchema>;

export const foreignKeyInfoSchema = z.object({
  name: z.string(),
  definition: z.string(),
  referencedSchema: z.string(),
  referencedTable: z.string(),
});
export type ForeignKeyInfo = z.infer<typeof foreignKeyInfoSchema>;

// ---------- autocomplete snapshot  ----------

export const autocompleteRelKindSchema = z.enum(["table", "view", "matview"]);
export type AutocompleteRelKind = z.infer<typeof autocompleteRelKindSchema>;

export const autocompleteColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  isJsonb: z.boolean(),
});
export type AutocompleteColumn = z.infer<typeof autocompleteColumnSchema>;

export const autocompleteRelationSchema = z.object({
  schema: z.string(),
  name: z.string(),
  kind: autocompleteRelKindSchema,
  columns: z.array(autocompleteColumnSchema),
});
export type AutocompleteRelation = z.infer<typeof autocompleteRelationSchema>;

export const autocompleteSnapshotSchema = z.object({
  connId: z.string(),
  searchPath: z.array(z.string()),
  relations: z.array(autocompleteRelationSchema),
  loadedAt: z.number(),
});
export type AutocompleteSnapshot = z.infer<typeof autocompleteSnapshotSchema>;

// ---------- connection lifecycle ----------

export function connectionConnect(id: string): Promise<ConnectInfo> {
  return invokeChecked("connection_connect", { id }, connectInfoSchema);
}

export function connectionDisconnect(id: string): Promise<void> {
  return invokeChecked("connection_disconnect", { id }, emptyResultSchema);
}

// ---------- schema introspection ----------

export function schemaListSchemas(connId: string): Promise<SchemaInfo[]> {
  return invokeChecked("schema_list_schemas", { connId }, z.array(schemaInfoSchema));
}

export function schemaListTables(connId: string, schema: string): Promise<TableInfo[]> {
  return invokeChecked("schema_list_tables", { connId, schema }, z.array(tableInfoSchema));
}

export function schemaListViews(connId: string, schema: string): Promise<ViewInfo[]> {
  return invokeChecked("schema_list_views", { connId, schema }, z.array(viewInfoSchema));
}

export function schemaListColumns(
  connId: string,
  schema: string,
  table: string,
): Promise<ColumnInfo[]> {
  return invokeChecked("schema_list_columns", { connId, schema, table }, z.array(columnInfoSchema));
}

export function schemaListIndexes(
  connId: string,
  schema: string,
  table: string,
): Promise<IndexInfo[]> {
  return invokeChecked("schema_list_indexes", { connId, schema, table }, z.array(indexInfoSchema));
}

export function schemaListForeignKeys(
  connId: string,
  schema: string,
  table: string,
): Promise<ForeignKeyInfo[]> {
  return invokeChecked(
    "schema_list_foreign_keys",
    { connId, schema, table },
    z.array(foreignKeyInfoSchema),
  );
}

export function schemaGetAutocompleteSnapshot(connId: string): Promise<AutocompleteSnapshot> {
  return invokeChecked("schema_get_autocomplete_snapshot", { connId }, autocompleteSnapshotSchema);
}

// ---------------------------------------------------------------------------
// — ERD auto-layout payload
// ---------------------------------------------------------------------------

const erdColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
  isForeignKey: z.boolean(),
  ordinal: z.number().int(),
});

const erdTableSchema = z.object({
  schema: z.string(),
  name: z.string(),
  columns: z.array(erdColumnSchema),
});

const erdForeignKeySchema = z.object({
  name: z.string(),
  sourceSchema: z.string(),
  sourceTable: z.string(),
  sourceColumns: z.array(z.string()),
  targetSchema: z.string(),
  targetTable: z.string(),
  targetColumns: z.array(z.string()),
});

export const erdSchemaGraphSchema = z.object({
  tables: z.array(erdTableSchema),
  foreignKeys: z.array(erdForeignKeySchema),
  fetchedInMs: z.number().int().nonnegative(),
});

export type ErdColumn = z.infer<typeof erdColumnSchema>;
export type ErdTable = z.infer<typeof erdTableSchema>;
export type ErdForeignKey = z.infer<typeof erdForeignKeySchema>;
export type ErdSchemaGraph = z.infer<typeof erdSchemaGraphSchema>;

export function erdGetSchemaGraph(connId: string, schemas?: string[]): Promise<ErdSchemaGraph> {
  return invokeChecked(
    "erd_get_schema_graph",
    { connId, schemas: schemas ?? null },
    erdSchemaGraphSchema,
  );
}

// ---------- schema apply + ERD positions ----------

export const applyResultSchema = z.object({
  statementsExecuted: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type ApplyResult = z.infer<typeof applyResultSchema>;

export const applyErrorSchema = z.object({
  failingStatementIndex: z.number().int().nonnegative().nullable(),
  failingSql: z.string(),
  pgErrorCode: z.string(),
  pgMessage: z.string(),
  pgHint: z.string().nullable(),
});
export type ApplyError = z.infer<typeof applyErrorSchema>;

export async function schemaApplyDdl(connId: string, sqlScript: string): Promise<ApplyResult> {
  try {
    return await invokeChecked("schema_apply_ddl", { connId, sqlScript }, applyResultSchema);
  } catch (raw) {
    // The Rust side returns a structured ApplyError on Result::Err. Tauri
    // surfaces it as the rejection value of the JS promise. Try to coerce.
    const parsed = applyErrorSchema.safeParse(raw);
    if (parsed.success) throw parsed.data;
    throw raw;
  }
}

export const nodePosSchema = z.object({
  nodeId: z.string(),
  x: z.number(),
  y: z.number(),
});
export type NodePos = z.infer<typeof nodePosSchema>;

export function erdSavePositions(
  connId: string,
  schemasKey: string,
  positions: NodePos[],
): Promise<void> {
  return invokeChecked("erd_save_positions", { connId, schemasKey, positions }, emptyResultSchema);
}

export function erdLoadPositions(connId: string, schemasKey: string): Promise<NodePos[]> {
  return invokeChecked("erd_load_positions", { connId, schemasKey }, z.array(nodePosSchema));
}

// ---------- query execution ----------

export const columnMetaSchema = z.object({
  name: z.string(),
  typeName: z.string(),
  isNumeric: z.boolean(),
});
export type ColumnMeta = z.infer<typeof columnMetaSchema>;

export const queryResultSchema = z.object({
  columns: z.array(columnMetaSchema),
  rows: z.array(z.array(z.string().nullable())),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  affectedRows: z.number().int().nonnegative().nullable(),
  statusMessage: z.string(),
});
export type QueryResult = z.infer<typeof queryResultSchema>;

export const queryErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notConnected"), connId: z.string() }),
  z.object({
    kind: z.literal("postgresError"),
    message: z.string(),
    position: z.number().int().nullable(),
    /** — five-character SQLSTATE if the server supplied one. */
    sqlstate: z.string().nullable().optional(),
  }),
  z.object({ kind: z.literal("poolError"), message: z.string() }),
  z.object({ kind: z.literal("storageError"), message: z.string() }),
  z.object({ kind: z.literal("cursorNotFound"), cursorId: z.string() }),
  z.object({ kind: z.literal("cancelled") }),
]);
export type QueryErrorPayload = z.infer<typeof queryErrorSchema>;

export class QueryError extends Error {
  readonly kind: QueryErrorPayload["kind"];
  readonly position: number | null;
  readonly connId: string | null;
  readonly cursorId: string | null;
  /** — five-character SQLSTATE for postgresError, else null. */
  readonly sqlstate: string | null;
  constructor(payload: QueryErrorPayload) {
    const message =
      "message" in payload
        ? payload.message
        : payload.kind === "cancelled"
          ? "query cancelled"
          : payload.kind === "cursorNotFound"
            ? `cursor not found: ${payload.cursorId}`
            : `not connected: ${payload.connId}`;
    super(message);
    this.name = "QueryError";
    this.kind = payload.kind;
    this.position = "position" in payload ? payload.position : null;
    this.connId = "connId" in payload ? payload.connId : null;
    this.cursorId = "cursorId" in payload ? payload.cursorId : null;
    this.sqlstate = payload.kind === "postgresError" ? (payload.sqlstate ?? null) : null;
  }
}

export const fetchPageSchema = z.object({
  rows: z.array(z.array(z.string().nullable())),
  exhausted: z.boolean(),
});
export type FetchPage = z.infer<typeof fetchPageSchema>;

export const openCursorResultSchema = z.object({
  cursorId: z.string(),
  columns: z.array(columnMetaSchema),
  firstPage: fetchPageSchema,
  durationMs: z.number().int().nonnegative(),
  affectedRows: z.number().int().nonnegative().nullable(),
  statusMessage: z.string(),
});
export type OpenCursorResult = z.infer<typeof openCursorResultSchema>;

export const editorTabRowSchema = z.object({
  id: z.string(),
  kind: z.enum(["editor", "object", "plan-diff"]),
  name: z.string(),
  content: z.string(),
  connectionId: z.string().nullable(),
  nodeKey: z.string().nullable(),
  cursorLine: z.number().int().min(1),
  cursorCol: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EditorTabRow = z.infer<typeof editorTabRowSchema>;

async function invokeCheckedQuery<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  schema: z.ZodSchema<T>,
): Promise<T> {
  try {
    const raw = await invoke<unknown>(command, args);
    return schema.parse(raw);
  } catch (err) {
    if (err && typeof err === "object" && "kind" in err) {
      const payload = queryErrorSchema.safeParse(err);
      if (payload.success) {
        throw new QueryError(payload.data);
      }
    }
    throw err;
  }
}

export function queryExecute(connId: string, sql: string): Promise<QueryResult> {
  return invokeCheckedQuery("query_execute", { connId, sql }, queryResultSchema);
}

export function tabsList(): Promise<EditorTabRow[]> {
  return invokeCheckedQuery("tabs_list", undefined, z.array(editorTabRowSchema));
}

export function tabsSave(tab: EditorTabRow): Promise<void> {
  return invokeCheckedQuery("tabs_save", { tab }, emptyResultSchema);
}

export function tabsDelete(id: string): Promise<void> {
  return invokeCheckedQuery("tabs_delete", { id }, emptyResultSchema);
}

export function queryOpenCursor(connId: string, sql: string): Promise<OpenCursorResult> {
  return invokeCheckedQuery("query_open_cursor", { connId, sql }, openCursorResultSchema);
}

// ---------- Multi-statement batch execution (post-S14) ---------------------

export const statementResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rowset"),
    index: z.number().int(),
    sql: z.string(),
    columns: z.array(columnMetaSchema),
    rows: z.array(z.array(z.string().nullable())),
    truncated: z.boolean(),
    cursorId: z.string().nullable(),
    // explicit "no more pages" signal, decoupled from
    // cursorId (which now stays Some on auto-closed single-page rowsets
    // so the jsonb editor can resolve row keys).
    exhausted: z.boolean(),
    durationMs: z.number().int(),
    statusMessage: z.string(),
  }),
  z.object({
    kind: z.literal("dml"),
    index: z.number().int(),
    sql: z.string(),
    affectedRows: z.number().int().nullable(),
    durationMs: z.number().int(),
    statusMessage: z.string(),
  }),
  z.object({
    kind: z.literal("error"),
    index: z.number().int(),
    sql: z.string(),
    error: queryErrorSchema,
  }),
]);
export type StatementResult = z.infer<typeof statementResultSchema>;

export const batchResultSchema = z.object({
  statements: z.array(statementResultSchema),
  totalDurationMs: z.number().int(),
  failedAt: z.number().int().nullable(),
});
export type BatchResult = z.infer<typeof batchResultSchema>;

/**
 * Run a batch of statements on ONE pooled connection. The last statement's
 * rowset (if any) opens a cursor when `cursorForLast=true`; intermediate
 * rowsets are inline-fetched up to 500 rows with a `truncated` flag. On the
 * first error the backend ROLLBACKs and stops — `failedAt` is the 0-based
 * index of the failed statement.
 */
export function queryRunBatch(
  connId: string,
  statements: string[],
  cursorForLast: boolean,
): Promise<BatchResult> {
  return invokeCheckedQuery(
    "query_run_batch",
    { connId, statements, cursorForLast },
    batchResultSchema,
  );
}

export function queryFetchPage(cursorId: string, limit: number): Promise<FetchPage> {
  return invokeCheckedQuery("query_fetch_page", { cursorId, limit }, fetchPageSchema);
}

export function queryCancel(cursorId: string): Promise<void> {
  return invokeCheckedQuery("query_cancel", { cursorId }, emptyResultSchema);
}

export function queryCloseCursor(cursorId: string): Promise<void> {
  return invokeCheckedQuery("query_close_cursor", { cursorId }, emptyResultSchema);
}

// ---------------------------------------------------------------------------
// — Query History
// ---------------------------------------------------------------------------

export const historyStatusSchema = z.enum(["ok", "error", "cancelled"]);
export type HistoryStatus = z.infer<typeof historyStatusSchema>;

export const historyRowSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  connectionName: z.string(),
  sql: z.string(),
  executedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  status: historyStatusSchema,
  rowsAffected: z.number().int().nonnegative().nullable(),
  rowsReturned: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(),
  errorMessage: z.string().nullable(),
  tag: z.string().nullable(),
  comment: z.string().nullable(),
  pinned: z.boolean(),
});
export type HistoryRow = z.infer<typeof historyRowSchema>;

export const historySearchFilterSchema = z.object({
  query: z.string().nullable(),
  connectionId: z.string().nullable(),
  status: historyStatusSchema.nullable(),
  pinnedOnly: z.boolean(),
  since: z.string().nullable(),
  until: z.string().nullable(),
  limit: z.number().int().min(1).max(200),
  offset: z.number().int().nonnegative(),
});
export type HistorySearchFilter = z.infer<typeof historySearchFilterSchema>;

export const historySearchResultSchema = z.object({
  rows: z.array(historyRowSchema),
  totalMatched: z.number().int().nonnegative(),
});
export type HistorySearchResult = z.infer<typeof historySearchResultSchema>;

export const historyExportResultSchema = z.object({
  path: z.string(),
  count: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});
export type HistoryExportResult = z.infer<typeof historyExportResultSchema>;

export function historySearch(filter: HistorySearchFilter): Promise<HistorySearchResult> {
  return invokeCheckedQuery("history_search", { filter }, historySearchResultSchema);
}

export function historySetPinned(id: string, pinned: boolean): Promise<void> {
  return invokeCheckedQuery("history_set_pinned", { id, pinned }, emptyResultSchema);
}

export function historySetTag(id: string, tag: string | null): Promise<void> {
  return invokeCheckedQuery("history_set_tag", { id, tag }, emptyResultSchema);
}

export function historySetComment(id: string, comment: string | null): Promise<void> {
  return invokeCheckedQuery("history_set_comment", { id, comment }, emptyResultSchema);
}

export function historyDelete(id: string): Promise<void> {
  return invokeCheckedQuery("history_delete", { id }, emptyResultSchema);
}

export function historyClearForConnection(connectionId: string): Promise<number> {
  return invokeCheckedQuery(
    "history_clear_for_connection",
    { connectionId },
    z.number().int().nonnegative(),
  );
}

export function historyExport(
  filter: HistorySearchFilter,
  path: string,
): Promise<HistoryExportResult> {
  return invokeCheckedQuery("history_export", { filter, path }, historyExportResultSchema);
}

export function connectionSetExcludeFromHistory(id: string, exclude: boolean): Promise<void> {
  return invokeChecked("connection_set_exclude_from_history", { id, exclude }, emptyResultSchema);
}

// ---------- per-field connection setters  ----------

export function connectionSetEnvironment(
  id: string,
  environment: Environment,
): Promise<Connection> {
  return invokeChecked("connection_set_environment", { id, environment }, connectionSchema);
}

export function connectionSetReadOnly(id: string, readOnly: boolean): Promise<Connection> {
  return invokeChecked("connection_set_read_only", { id, readOnly }, connectionSchema);
}

export function connectionSetSlowQueryWarning(id: string, enabled: boolean): Promise<Connection> {
  return invokeChecked("connection_set_slow_query_warning", { id, enabled }, connectionSchema);
}

export function connectionSetConfirmDestructive(id: string, enabled: boolean): Promise<Connection> {
  return invokeChecked("connection_set_confirm_destructive", { id, enabled }, connectionSchema);
}

// ---------- snippets  ----------

export const userSnippetSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  prefix: z.string(),
  body: z.string(),
  documentation: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserSnippet = z.infer<typeof userSnippetSchema>;

export const newUserSnippetSchema = z.object({
  label: z.string(),
  prefix: z.string(),
  body: z.string(),
  documentation: z.string().default(""),
});
export type NewUserSnippet = z.infer<typeof newUserSnippetSchema>;

export const updateUserSnippetSchema = z.object({
  label: z.string(),
  prefix: z.string(),
  body: z.string(),
  documentation: z.string(),
});
export type UpdateUserSnippet = z.infer<typeof updateUserSnippetSchema>;

export const snippetExportBundleSchema = z.object({
  version: z.number().int(),
  kind: z.string(),
  exportedAt: z.string(),
  snippets: z.array(userSnippetSchema),
});
export type SnippetExportBundle = z.infer<typeof snippetExportBundleSchema>;

export function snippetsList(): Promise<UserSnippet[]> {
  return invokeChecked("snippets_list", undefined, z.array(userSnippetSchema));
}

export function snippetsCreate(input: NewUserSnippet): Promise<UserSnippet> {
  return invokeChecked("snippets_create", { input }, userSnippetSchema);
}

export function snippetsUpdate(id: number, input: UpdateUserSnippet): Promise<UserSnippet> {
  return invokeChecked("snippets_update", { id, input }, userSnippetSchema);
}

export function snippetsDelete(id: number): Promise<void> {
  return invokeChecked("snippets_delete", { id }, emptyResultSchema);
}

/** Writes the export bundle to `path` on disk; returns the bundle for confirmation. */
export function snippetsExport(path: string): Promise<SnippetExportBundle> {
  return invokeChecked("snippets_export", { path }, snippetExportBundleSchema);
}

/** Reads bundle JSON from `path` and creates each snippet; returns the imported list. */
export function snippetsImport(path: string): Promise<UserSnippet[]> {
  return invokeChecked("snippets_import", { path }, z.array(userSnippetSchema));
}

// ---------- explain cost  ----------

export function queryExplainCost(connId: string, sql: string): Promise<number> {
  return invokeChecked("query_explain_cost", { connId, sql }, z.number());
}

// ---------- explain visualizer  ----------

export const explainModeSchema = z.enum(["explain", "analyze"]);
export type ExplainMode = z.infer<typeof explainModeSchema>;

export const explainOptionsSchema = z.object({
  mode: explainModeSchema,
  verbose: z.boolean(),
  wal: z.boolean(),
  timing: z.boolean(),
});
export type ExplainOptions = z.infer<typeof explainOptionsSchema>;

export const explainResultSchema = z.object({
  planJson: z.unknown(),
  durationMs: z.number(),
  statusMessage: z.string(),
});
export type ExplainResult = z.infer<typeof explainResultSchema>;

/**
 * — fetch full EXPLAIN plan for the pev2 visualizer.
 * `tabId` is the EXPLAIN tab id (`explain-${sourceTabId}`); the backend
 * uses it to register the in-flight pid for `queryExplainCancel`.
 */
export function queryExplain(
  connId: string,
  tabId: string,
  sql: string,
  options: ExplainOptions,
): Promise<ExplainResult> {
  return invokeChecked("query_explain", { connId, tabId, sql, options }, explainResultSchema);
}

/**
 * — cancel an in-flight EXPLAIN. No-op if the request already
 * completed (backend ignores unknown tab ids).
 */
export function queryExplainCancel(connId: string, tabId: string): Promise<void> {
  return invokeChecked("query_explain_cancel", { connId, tabId }, emptyResultSchema);
}

// ---------- — Recent Plans ----------

export const recentPlanModeSchema = z.enum(["explain", "analyze"]);
export type RecentPlanMode = z.infer<typeof recentPlanModeSchema>;

export const recentPlanRowSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  connectionName: z.string(),
  sql: z.string(),
  planJson: z.string(),
  executedAt: z.string(),
  durationMs: z.number(),
  totalCost: z.number().nullable(),
  mode: recentPlanModeSchema,
  optionsJson: z.string(),
  involvedTables: z.array(z.string()),
  pinned: z.boolean(),
});
export type RecentPlanRow = z.infer<typeof recentPlanRowSchema>;

export const recentPlansFilterSchema = z.object({
  query: z.string().optional(),
  table: z.string().optional(),
  costMin: z.number().optional(),
  costMax: z.number().optional(),
  connectionId: z.string().optional(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type RecentPlansFilter = z.infer<typeof recentPlansFilterSchema>;

export const recentPlansSearchResultSchema = z.object({
  rows: z.array(recentPlanRowSchema),
  total: z.number().int().nonnegative(),
});
export type RecentPlansSearchResult = z.infer<typeof recentPlansSearchResultSchema>;

export const newRecentPlanSchema = z.object({
  connectionId: z.string(),
  connectionName: z.string(),
  sql: z.string(),
  planJson: z.unknown(),
  durationMs: z.number(),
  mode: recentPlanModeSchema,
  optionsJson: z.string(),
});
export type NewRecentPlan = z.infer<typeof newRecentPlanSchema>;

export function recentPlansSave(input: NewRecentPlan): Promise<string> {
  return invokeChecked("recent_plans_save", { new: input }, z.string());
}

export function recentPlansSearch(filter: RecentPlansFilter): Promise<RecentPlansSearchResult> {
  return invokeChecked("recent_plans_search", { filter }, recentPlansSearchResultSchema);
}

export function recentPlansGet(id: string): Promise<RecentPlanRow | null> {
  return invokeChecked("recent_plans_get", { id }, recentPlanRowSchema.nullable());
}

export function recentPlansSetPinned(id: string, pinned: boolean): Promise<void> {
  return invokeChecked("recent_plans_set_pinned", { id, pinned }, emptyResultSchema);
}

export function recentPlansDelete(id: string): Promise<void> {
  return invokeChecked("recent_plans_delete", { id }, emptyResultSchema);
}

export function recentPlansClearForConnection(connectionId: string): Promise<number> {
  return invokeChecked(
    "recent_plans_clear_for_connection",
    { connectionId },
    z.number().int().nonnegative(),
  );
}

export function connectionSetExcludeFromRecentPlans(id: string, exclude: boolean): Promise<void> {
  return invokeChecked(
    "connection_set_exclude_from_recent_plans",
    { id, exclude },
    emptyResultSchema,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// — Health actions (zod schemas; IPC wrappers added in Task C2).
// ─────────────────────────────────────────────────────────────────────────

export const actionStatusSchema = z.enum(["completed", "notFound", "terminated"]);
export type ActionStatusWire = z.infer<typeof actionStatusSchema>;

export const actionResultSchema = z.object({
  actionId: z.string(),
  durationMs: z.number().int().nonnegative(),
  status: actionStatusSchema,
});
export type ActionResultWire = z.infer<typeof actionResultSchema>;

export const actionErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notConnected") }),
  z.object({ kind: z.literal("forbidden"), required: z.string() }),
  z.object({ kind: z.literal("activeTransaction") }),
  z.object({ kind: z.literal("objectNotFound"), target: z.string() }),
  z.object({
    kind: z.literal("queryFailed"),
    sqlstate: z.string(),
    message: z.string(),
  }),
]);
export type ActionErrorWire = z.infer<typeof actionErrorSchema>;

export const progressSnapshotSchema = z.object({
  actionId: z.string(),
  phase: z.string(),
  percent: z.number().nullable(),
  blocksScanned: z.number().int().nullable(),
  blocksTotal: z.number().int().nullable(),
  finished: z.boolean(),
});
export type ProgressSnapshotWire = z.infer<typeof progressSnapshotSchema>;

// ─────────────────────────────────────────────────────────────────────────
// — Health action IPC wrappers (Task C2).
// ─────────────────────────────────────────────────────────────────────────

async function invokeCheckedAction<T>(
  cmd: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const raw = await invoke(cmd, args);
    return schema.parse(raw);
  } catch (e) {
    const parsed = actionErrorSchema.safeParse(e);
    if (parsed.success) throw parsed.data;
    throw {
      kind: "queryFailed",
      sqlstate: "",
      message: e instanceof Error ? e.message : String(e),
    } satisfies ActionErrorWire;
  }
}

export async function healthActionReindexTable(
  connId: string,
  schema: string,
  table: string,
): Promise<ActionResultWire> {
  return await invokeCheckedAction(
    "health_action_reindex_table",
    { connId, schema, table },
    actionResultSchema,
  );
}

export async function healthActionVacuum(
  connId: string,
  schema: string,
  table: string,
): Promise<ActionResultWire> {
  return await invokeCheckedAction(
    "health_action_vacuum",
    { connId, schema, table },
    actionResultSchema,
  );
}

export async function healthActionAnalyze(
  connId: string,
  schema: string,
  table: string,
): Promise<ActionResultWire> {
  return await invokeCheckedAction(
    "health_action_analyze",
    { connId, schema, table },
    actionResultSchema,
  );
}

export async function healthActionDropIndex(
  connId: string,
  schema: string,
  index: string,
): Promise<ActionResultWire> {
  return await invokeCheckedAction(
    "health_action_drop_index",
    { connId, schema, index },
    actionResultSchema,
  );
}

export async function healthActionKillPid(
  connId: string,
  pid: number,
  terminate: boolean,
): Promise<ActionResultWire> {
  return await invokeCheckedAction(
    "health_action_kill_pid",
    { connId, pid, terminate },
    actionResultSchema,
  );
}

export async function healthActionCheckPid(connId: string, pid: number): Promise<boolean> {
  try {
    const raw = await invoke("health_action_check_pid", { connId, pid });
    return z.boolean().parse(raw);
  } catch (e) {
    const parsed = actionErrorSchema.safeParse(e);
    if (parsed.success) throw parsed.data;
    throw {
      kind: "queryFailed",
      sqlstate: "",
      message: e instanceof Error ? e.message : String(e),
    } satisfies ActionErrorWire;
  }
}

export async function healthActionProgress(
  connId: string,
  actionId: string,
): Promise<ProgressSnapshotWire> {
  return await invokeCheckedAction(
    "health_action_progress",
    { connId, actionId },
    progressSnapshotSchema,
  );
}

const actionStartedPayloadSchema = z.object({
  actionId: z.string(),
  pid: z.number().int(),
});

export async function onHealthActionStarted(
  cb: (payload: { actionId: string; pid: number }) => void,
): Promise<UnlistenFn> {
  return listen("health-action-started", (event) => {
    const parsed = actionStartedPayloadSchema.safeParse(event.payload);
    if (parsed.success) cb(parsed.data);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// — Live Ops Dashboard.
// ─────────────────────────────────────────────────────────────────────────

export const sessionsModeSchema = z.enum(["all", "blocked"]);
export type SessionsMode = z.infer<typeof sessionsModeSchema>;

export const slowSortBySchema = z.enum(["meanExecTime", "totalExecTime", "calls", "meanRows"]);
export type SlowSortBy = z.infer<typeof slowSortBySchema>;

export const sessionSchema = z.object({
  pid: z.number().int(),
  state: z.string(),
  username: z.string(),
  applicationName: z.string().nullable(),
  clientAddr: z.string().nullable(),
  query: z.string(),
  queryStart: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  waitEventType: z.string().nullable(),
  waitEvent: z.string().nullable(),
  backendType: z.string(),
});
export type Session = z.infer<typeof sessionSchema>;

export const blockingEdgeSchema = z.object({
  blockerPid: z.number().int(),
  blockedPid: z.number().int(),
  lockMode: z.string().nullable(),
  lockType: z.string().nullable(),
  relation: z.string().nullable(),
});
export type BlockingEdge = z.infer<typeof blockingEdgeSchema>;

export const sessionsSnapshotSchema = z.object({
  sessions: z.array(sessionSchema),
  blockingEdges: z.array(blockingEdgeSchema),
  fetchedAt: z.string(),
  truncated: z.boolean(),
});
export type SessionsSnapshot = z.infer<typeof sessionsSnapshotSchema>;

export const slowQuerySchema = z.object({
  query: z.string(),
  meanExecTimeMs: z.number(),
  totalExecTimeMs: z.number(),
  calls: z.number().int(),
  meanRows: z.number(),
  rolname: z.string().nullable(),
});
export type SlowQuery = z.infer<typeof slowQuerySchema>;

export const slowSnapshotSchema = z.object({
  rows: z.array(slowQuerySchema),
  sortBy: slowSortBySchema,
  fetchedAt: z.string(),
});
export type SlowSnapshot = z.infer<typeof slowSnapshotSchema>;

// S14 introduces a richer slot row (with retention bytes/pct, db, active flag,
// wal_status). S12's `replicationSlotRowSchema` is a subset shape used by the
// health card — kept to avoid breaking that import. S14 names are prefixed
// with `liveOps*` to coexist.
export const liveOpsSlotRowSchema = z.object({
  slotName: z.string(),
  slotType: z.string(),
  database: z.string().nullable(),
  active: z.boolean(),
  walStatus: z.string().nullable(),
  lagBytes: z.number().int().nullable(),
  lagSeconds: z.number().nullable(),
  state: z.string().nullable(),
  retentionBytes: z.number().int().nullable(),
  retentionPctOfMax: z.number().nullable(),
});
export type LiveOpsSlotRow = z.infer<typeof liveOpsSlotRowSchema>;

export const liveOpsPublicationRowSchema = z.object({
  pubname: z.string(),
  puballtables: z.boolean(),
  pubinsert: z.boolean(),
  pubupdate: z.boolean(),
  pubdelete: z.boolean(),
  pubtruncate: z.boolean(),
  tableCount: z.number().int(),
});
export type LiveOpsPublicationRow = z.infer<typeof liveOpsPublicationRowSchema>;

export const liveOpsSubscriptionStatSchema = z.object({
  receivedLsn: z.string().nullable(),
  lastMsgSendTime: z.string().nullable(),
  latestEndTime: z.string().nullable(),
});
export type LiveOpsSubscriptionStat = z.infer<typeof liveOpsSubscriptionStatSchema>;

export const liveOpsSubscriptionRowSchema = z.object({
  subname: z.string(),
  subenabled: z.boolean(),
  subconninfoRedacted: z.string(),
  publications: z.array(z.string()),
  stat: liveOpsSubscriptionStatSchema.nullable(),
});
export type LiveOpsSubscriptionRow = z.infer<typeof liveOpsSubscriptionRowSchema>;

export const replicationOverviewSchema = z.object({
  slots: z.array(liveOpsSlotRowSchema),
  publications: z.array(liveOpsPublicationRowSchema),
  subscriptions: z.array(liveOpsSubscriptionRowSchema),
  fetchedAt: z.string(),
});
export type ReplicationOverview = z.infer<typeof replicationOverviewSchema>;

export const liveOpsErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notConnected") }),
  z.object({ kind: z.literal("unavailable"), extension: z.string(), installSql: z.string() }),
  z.object({ kind: z.literal("forbidden"), requiredRole: z.string() }),
  z.object({ kind: z.literal("queryFailed"), sqlstate: z.string(), message: z.string() }),
]);
export type LiveOpsError = z.infer<typeof liveOpsErrorSchema>;

export type LiveOpsResult<T> = { ok: true; data: T } | { ok: false; error: LiveOpsError };

async function invokeLiveOps<T>(
  cmd: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<LiveOpsResult<T>> {
  try {
    const raw = await invoke(cmd, args);
    return { ok: true, data: schema.parse(raw) };
  } catch (e) {
    const parsed = liveOpsErrorSchema.safeParse(e);
    if (parsed.success) return { ok: false, error: parsed.data };
    // eslint-disable-next-line no-console -- devtools breadcrumb so users can
    // report what Tauri actually returned when we mislabel an unknown shape
    // as queryFailed.
    console.warn(`[live-ops] ${cmd} returned an unexpected error shape:`, e);
    return {
      ok: false,
      error: {
        kind: "queryFailed",
        sqlstate: "",
        // Tauri/Zod rejection shapes vary: native Error, serialized string,
        // or a plain object that doesn't match `liveOpsErrorSchema`. Plain
        // `String(e)` collapses any object to `"[object Object]"`, so unwrap
        // the most informative field we can find before falling back to JSON.
        message: extractErrorMessage(e, cmd),
      },
    };
  }
}

function extractErrorMessage(e: unknown, cmd: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    try {
      return JSON.stringify(e);
    } catch {
      // fall through
    }
  }
  return `${cmd} failed (${String(e)})`;
}

export function liveOpsSessions(
  connId: string,
  mode: SessionsMode,
): Promise<LiveOpsResult<SessionsSnapshot>> {
  return invokeLiveOps("live_ops_sessions", { connId, mode }, sessionsSnapshotSchema);
}
export function liveOpsSlow(
  connId: string,
  sortBy: SlowSortBy,
): Promise<LiveOpsResult<SlowSnapshot>> {
  return invokeLiveOps("live_ops_slow", { connId, sortBy }, slowSnapshotSchema);
}
export function liveOpsReplication(connId: string): Promise<LiveOpsResult<ReplicationOverview>> {
  return invokeLiveOps("live_ops_replication", { connId }, replicationOverviewSchema);
}

// ---------- — JSONB Tree Editor (write path) ----------

export const readOnlyReasonSchema = z.enum([
  "noBaseTable",
  "multipleTables",
  "matview",
  "foreignTable",
  "viewWithoutPk",
  "partitionedNoPk",
  "noColumnMetadata",
]);
export type ReadOnlyReason = z.infer<typeof readOnlyReasonSchema>;

export const pkColumnSchema = z.object({
  name: z.string(),
  value: z.string().nullable(),
  typeName: z.string(),
});
export type PkColumn = z.infer<typeof pkColumnSchema>;

export const rowKeySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pk"),
    schema: z.string(),
    table: z.string(),
    columns: z.array(pkColumnSchema).min(1),
  }),
  z.object({
    kind: z.literal("ctid"),
    schema: z.string(),
    table: z.string(),
    ctid: z.string(),
  }),
  z.object({
    kind: z.literal("readOnly"),
    reason: readOnlyReasonSchema,
  }),
]);
export type RowKey = z.infer<typeof rowKeySchema>;

export const jsonbOpSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set"),
    path: z.array(z.string()),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal("delete"),
    path: z.array(z.string()),
  }),
]);
export type JsonbOp = z.infer<typeof jsonbOpSchema>;

export const jsonbDiffSchema = z.object({
  ops: z.array(jsonbOpSchema),
  fullReplace: z.boolean(),
  fullValue: z.unknown().optional(),
});
export type JsonbDiff = z.infer<typeof jsonbDiffSchema>;

export const jsonbWriteContextSchema = z.object({
  connId: z.string(),
  rowKey: rowKeySchema,
  column: z.string(),
  oldValue: z.string(),
  newValue: z.string(),
  confirmedTableName: z.string().nullable(),
});
export type JsonbWriteContext = z.infer<typeof jsonbWriteContextSchema>;

export const jsonbSaveResultSchema = z.object({
  sqlExecuted: z.string(),
  affectedRows: z.number(),
  durationMs: z.number(),
  newCellValue: z.string(),
});
export type JsonbSaveResult = z.infer<typeof jsonbSaveResultSchema>;

/** Resolve the row key for a cell about to be edited in the JSONB modal. */
export async function jsonbResolveRowKey(args: {
  connId: string;
  cursorId: string;
  rowIdx: number;
  rowValues: Array<string | null>;
}): Promise<RowKey> {
  const raw = await invoke<unknown>("jsonb_resolve_row_key", args);
  return rowKeySchema.parse(raw);
}

/** Apply a JSONB write. Backend computes the diff and runs a parameterized
 * UPDATE; honours the production typing-confirm guard via `confirmedTableName`. */
export async function jsonbSave(ctx: JsonbWriteContext): Promise<JsonbSaveResult> {
  const raw = await invoke<unknown>("jsonb_save", { ctx });
  return jsonbSaveResultSchema.parse(raw);
}

// ---------- JSONB schema inference ----------

export const fqnSchema = z.object({
  schema: z.string(),
  table: z.string(),
  column: z.string(),
});
export type Fqn = z.infer<typeof fqnSchema>;

// PathSegment wire form: Key(string) → { key: string }; ArrayWildcard → "arraywildcard".
export const pathSegmentSchema = z.union([
  z.object({ key: z.string() }),
  z.literal("arraywildcard"),
]);
export type PathSegment = z.infer<typeof pathSegmentSchema>;

const primitiveValueSchema = z.enum(["string", "number", "boolean", "null"]);

// ProbableType uses internally-tagged JSON: { kind: "...", ... }.
// Use z.lazy for the recursive Array/Union cases.
export const probableTypeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("primitive"), value: primitiveValueSchema }),
    z.object({ kind: z.literal("enum"), values: z.array(z.string()) }),
    z.object({ kind: z.literal("object") }),
    z.object({ kind: z.literal("array"), element: probableTypeSchema }),
    z.object({ kind: z.literal("union"), variants: z.array(probableTypeSchema) }),
  ]),
);
export type ProbableType = z.infer<typeof probableTypeSchema>;

export const inferredNodeSchema = z.object({
  path: z.array(pathSegmentSchema),
  kind: probableTypeSchema,
  freq: z.number(),
  samples: z.array(z.unknown()),
});
export type InferredNode = z.infer<typeof inferredNodeSchema>;

export const inferredSchemaSchema = z.object({
  nodes: z.array(inferredNodeSchema),
  sampleCount: z.number(),
  generatedAt: z.number(),
});
export type InferredSchema = z.infer<typeof inferredSchemaSchema>;

export const inferenceResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), schema: inferredSchemaSchema }),
  z.object({ status: z.literal("stale"), schema: inferredSchemaSchema }),
  z.object({ status: z.literal("pending") }),
]);
export type InferenceResponse = z.infer<typeof inferenceResponseSchema>;

export function jsonbInferenceRequest(connId: string, fqn: Fqn): Promise<InferenceResponse> {
  return invokeChecked(
    "jsonb_inference_request",
    { connId, schema: fqn.schema, table: fqn.table, column: fqn.column },
    inferenceResponseSchema,
  );
}

export function jsonbInferenceInvalidate(connId: string, fqn: Fqn): Promise<void> {
  return invokeChecked(
    "jsonb_inference_invalidate",
    { connId, schema: fqn.schema, table: fqn.table, column: fqn.column },
    emptyResultSchema,
  );
}

export interface JsonbInferenceUpdatedEvent {
  connId: string;
  fqn: Fqn;
  schema: InferredSchema;
}

export interface JsonbInferenceFailedEvent {
  connId: string;
  fqn: Fqn;
  message: string;
}

/**
 * — subscribe to inference background-task results.
 * Returns a single unsubscribe function that detaches both listeners.
 */
export async function subscribeJsonbInference(
  onUpdated: (e: JsonbInferenceUpdatedEvent) => void,
  onFailed: (e: JsonbInferenceFailedEvent) => void,
): Promise<() => void> {
  const offUpd: UnlistenFn = await listen<JsonbInferenceUpdatedEvent>(
    "jsonb-inference-updated",
    (ev) => onUpdated(ev.payload),
  );
  const offFail: UnlistenFn = await listen<JsonbInferenceFailedEvent>(
    "jsonb-inference-failed",
    (ev) => onFailed(ev.payload),
  );
  return () => {
    offUpd();
    offFail();
  };
}

// ---------- JSONB Query Builder ----------

export const builderValueSchema: z.ZodType<unknown> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("string"), value: z.string() }),
  z.object({ kind: z.literal("number"), value: z.string() }),
  z.object({ kind: z.literal("bool"), value: z.boolean() }),
  z.object({ kind: z.literal("null") }),
  z.object({ kind: z.literal("jsonLiteral"), value: z.string() }),
]);
export type BuilderValue = z.infer<typeof builderValueSchema>;

export const comparatorSchema = z.enum(["eq", "ne", "gt", "lt", "ge", "le", "likeRegex"]);
export type Comparator = z.infer<typeof comparatorSchema>;

export const extractModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("projection") }),
  z.object({ kind: z.literal("comparison"), eqValue: builderValueSchema }),
]);
export type ExtractMode = z.infer<typeof extractModeSchema>;

export const builderOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existence") }),
  z.object({ kind: z.literal("containment") }),
  z.object({ kind: z.literal("pathExtract"), mode: extractModeSchema }),
  z.object({
    kind: z.literal("pathPredicate"),
    comparator: comparatorSchema,
    rhs: builderValueSchema,
  }),
]);
export type BuilderOp = z.infer<typeof builderOpSchema>;

export const builderRequestSchema = z.object({
  connId: z.string(),
  fqn: fqnSchema,
  op: builderOpSchema,
  path: z.array(pathSegmentSchema),
  value: builderValueSchema,
});
export type BuilderRequest = z.infer<typeof builderRequestSchema>;

export const builderWarningSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existenceTopLevel") }),
  z.object({ kind: z.literal("pathTooDeep"), limit: z.number() }),
]);
export type BuilderWarning = z.infer<typeof builderWarningSchema>;

export const builderPreviewSchema = z.object({
  sql: z.string(),
  warnings: z.array(builderWarningSchema),
});
export type BuilderPreview = z.infer<typeof builderPreviewSchema>;

export function jsonbBuilderPreview(req: BuilderRequest): Promise<BuilderPreview> {
  return invokeChecked("jsonb_builder_preview", { req }, builderPreviewSchema);
}

// ---------- GIN Index Suggester ----------

export const suggesterScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({
    kind: z.literal("column"),
    schema: z.string(),
    table: z.string(),
    column: z.string(),
  }),
]);
export type SuggesterScope = z.infer<typeof suggesterScopeSchema>;

export const extensionAvailabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("available") }),
  z.object({ kind: z.literal("unavailable"), installSql: z.string() }),
]);
export type ExtensionAvailability = z.infer<typeof extensionAvailabilitySchema>;

export const extensionStatusSchema = z.object({
  pgStatStatements: extensionAvailabilitySchema,
  hypopg: extensionAvailabilitySchema,
  genericPlan: z.boolean(),
});
export type ExtensionStatus = z.infer<typeof extensionStatusSchema>;

export const opClassSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("jsonbOps") }),
  z.object({ kind: z.literal("jsonbPathOps") }),
  z.object({ kind: z.literal("expression"), expr: z.string() }),
]);
export type OpClass = z.infer<typeof opClassSchema>;

export const suggestionRationaleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mined"),
    calls: z.number(),
    totalExecTimeMs: z.number(),
    opsSeen: z.array(z.string()),
  }),
  z.object({ kind: z.literal("generic") }),
]);
export type SuggestionRationale = z.infer<typeof suggestionRationaleSchema>;

export const suggestionSchema = z.object({
  schema: z.string(),
  table: z.string(),
  column: z.string(),
  opClass: opClassSchema,
  recommendedSql: z.string(),
  indexName: z.string(),
  rationale: suggestionRationaleSchema,
  estimatedSizeBytes: z.number().nullable().optional(),
  representativeQuery: z.string().nullable().optional(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const suggesterResultSchema = z.object({
  extensions: extensionStatusSchema,
  suggestions: z.array(suggestionSchema),
  generatedAt: z.number(),
});
export type SuggesterResult = z.infer<typeof suggesterResultSchema>;

export const hypoPgUnavailableReasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("extensionMissing") }),
  z.object({
    kind: z.literal("pgVersionTooOld"),
    actual: z.string(),
    required: z.string(),
  }),
  z.object({ kind: z.literal("noRepresentativeQuery") }),
  z.object({ kind: z.literal("plannerError"), message: z.string() }),
]);
export type HypoPgUnavailableReason = z.infer<typeof hypoPgUnavailableReasonSchema>;

export const hypoPgEstimateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("computed"),
    baselineCost: z.number(),
    hypotheticalCost: z.number(),
    reductionPct: z.number(),
  }),
  z.object({
    kind: z.literal("unavailable"),
    reason: hypoPgUnavailableReasonSchema,
  }),
]);
export type HypoPgEstimate = z.infer<typeof hypoPgEstimateSchema>;

export function jsonbSuggesterRun(connId: string, scope: SuggesterScope): Promise<SuggesterResult> {
  return invokeChecked("jsonb_suggester_run", { req: { connId, scope } }, suggesterResultSchema);
}

export function jsonbSuggesterHypotheticalExplain(args: {
  connId: string;
  recommendedSql: string;
  representativeQuery: string;
}): Promise<HypoPgEstimate> {
  return invokeChecked("jsonb_suggester_hypothetical_explain", args, hypoPgEstimateSchema);
}

// ---------------------------------------------------------------------------
// — full-detail introspection types (mirror of backend DTOs).
// ---------------------------------------------------------------------------

export const generatedColumnSchema = z.object({
  kind: z.literal("stored"),
  expression: z.string(),
});
export type GeneratedColumn = z.infer<typeof generatedColumnSchema>;

export const columnDefinitionSchema = z.object({
  name: z.string(),
  typeText: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  generated: generatedColumnSchema.nullable(),
  comment: z.string().nullable(),
  ordinal: z.number().int(),
});
export type ColumnDefinition = z.infer<typeof columnDefinitionSchema>;

export const constraintDefinitionSchema = z.object({
  name: z.string(),
  kind: z.enum(["pk", "unique", "fk", "check"]),
  definition: z.string(),
  columns: z.array(z.string()),
  refSchema: z.string().nullable(),
  refTable: z.string().nullable(),
  refColumns: z.array(z.string()),
  expression: z.string().nullable(),
});
export type ConstraintDefinition = z.infer<typeof constraintDefinitionSchema>;

export const indexDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  table: z.string(),
  method: z.string(),
  unique: z.boolean(),
  primary: z.boolean(),
  columns: z.array(z.string()),
  include: z.array(z.string()),
  predicate: z.string().nullable(),
  definition: z.string(),
});
export type IndexDefinition = z.infer<typeof indexDefinitionSchema>;

export const partitionInfoSchema = z.object({
  strategy: z.enum(["range", "list", "hash"]),
  key: z.string(),
});
export type PartitionInfo = z.infer<typeof partitionInfoSchema>;

export const tableDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  comment: z.string().nullable(),
  columns: z.array(columnDefinitionSchema),
  constraints: z.array(constraintDefinitionSchema),
  indexes: z.array(indexDefinitionSchema),
  rlsEnabled: z.boolean(),
  partition: partitionInfoSchema.nullable(),
});
export type TableDefinition = z.infer<typeof tableDefinitionSchema>;

export const viewDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  body: z.string(),
  comment: z.string().nullable(),
});
export type ViewDefinition = z.infer<typeof viewDefinitionSchema>;

export const matviewDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  body: z.string(),
  populated: z.boolean(),
  comment: z.string().nullable(),
});
export type MatviewDefinition = z.infer<typeof matviewDefinitionSchema>;

export const sequenceOwnedBySchema = z.object({
  schema: z.string(),
  table: z.string(),
  column: z.string(),
});
export type SequenceOwnedBy = z.infer<typeof sequenceOwnedBySchema>;

export const sequenceDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  dataType: z.enum(["smallint", "integer", "bigint"]),
  start: z.number(),
  increment: z.number(),
  minValue: z.number(),
  maxValue: z.number(),
  cache: z.number(),
  cycle: z.boolean(),
  ownedBy: sequenceOwnedBySchema.nullable(),
});
export type SequenceDefinition = z.infer<typeof sequenceDefinitionSchema>;

export const matviewSummarySchema = z.object({
  name: z.string(),
  populated: z.boolean(),
  comment: z.string().nullable(),
});
export type MatviewSummary = z.infer<typeof matviewSummarySchema>;

export const sequenceSummarySchema = z.object({
  name: z.string(),
  dataType: z.string(),
});
export type SequenceSummary = z.infer<typeof sequenceSummarySchema>;

export function schemaGetTableDefinition(
  connId: string,
  schema: string,
  table: string,
): Promise<TableDefinition> {
  return invokeChecked(
    "schema_get_table_definition",
    { connId, schema, table },
    tableDefinitionSchema,
  );
}

export function schemaGetViewDefinition(
  connId: string,
  schema: string,
  view: string,
): Promise<ViewDefinition> {
  return invokeChecked(
    "schema_get_view_definition",
    { connId, schema, view },
    viewDefinitionSchema,
  );
}

export function schemaGetMatviewDefinition(
  connId: string,
  schema: string,
  matview: string,
): Promise<MatviewDefinition> {
  return invokeChecked(
    "schema_get_matview_definition",
    { connId, schema, matview },
    matviewDefinitionSchema,
  );
}

export function schemaGetIndexDefinition(
  connId: string,
  schema: string,
  index: string,
): Promise<IndexDefinition> {
  return invokeChecked(
    "schema_get_index_definition",
    { connId, schema, index },
    indexDefinitionSchema,
  );
}

export function schemaGetSequenceDefinition(
  connId: string,
  schema: string,
  sequence: string,
): Promise<SequenceDefinition> {
  return invokeChecked(
    "schema_get_sequence_definition",
    { connId, schema, sequence },
    sequenceDefinitionSchema,
  );
}

export function schemaListMatviews(connId: string, schema: string): Promise<MatviewSummary[]> {
  return invokeChecked("schema_list_matviews", { connId, schema }, z.array(matviewSummarySchema));
}

export function schemaListSequences(connId: string, schema: string): Promise<SequenceSummary[]> {
  return invokeChecked("schema_list_sequences", { connId, schema }, z.array(sequenceSummarySchema));
}

// ---------------------------------------------------------------------------
// — function/procedure/trigger introspection types.
// ---------------------------------------------------------------------------

export const functionParameterSchema = z.object({
  name: z.string(),
  mode: z.enum(["in", "out", "inout", "variadic"]),
  typeText: z.string(),
  default: z.string().nullable(),
});
export type FunctionParameter = z.infer<typeof functionParameterSchema>;

export const triggerEventsSchema = z.object({
  insert: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
  truncate: z.boolean(),
});
export type TriggerEvents = z.infer<typeof triggerEventsSchema>;

export const functionDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  language: z.string(),
  parameters: z.array(functionParameterSchema),
  returnKind: z.enum(["scalar", "setof", "trigger", "void"]),
  returnType: z.string().nullable(),
  body: z.string(),
  volatility: z.enum(["volatile", "stable", "immutable"]),
  parallelSafety: z.enum(["unsafe", "restricted", "safe"]),
  securityDefiner: z.boolean(),
  cost: z.number().nullable(),
  estimatedRows: z.number().nullable(),
  comment: z.string().nullable(),
});
export type FunctionDefinition = z.infer<typeof functionDefinitionSchema>;

export const procedureDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  language: z.string(),
  parameters: z.array(functionParameterSchema),
  body: z.string(),
  securityDefiner: z.boolean(),
  comment: z.string().nullable(),
});
export type ProcedureDefinition = z.infer<typeof procedureDefinitionSchema>;

export const triggerDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  tableSchema: z.string(),
  tableName: z.string(),
  timing: z.enum(["before", "after", "instead_of"]),
  events: triggerEventsSchema,
  updateColumns: z.array(z.string()),
  forEach: z.enum(["row", "statement"]),
  whenClause: z.string().nullable(),
  functionSchema: z.string(),
  functionName: z.string(),
  enabled: z.boolean(),
});
export type TriggerDefinition = z.infer<typeof triggerDefinitionSchema>;

export const functionSummarySchema = z.object({
  name: z.string(),
  args: z.string(),
  returnKind: z.enum(["scalar", "setof", "trigger", "void"]),
  returnType: z.string().nullable(),
});
export type FunctionSummary = z.infer<typeof functionSummarySchema>;

export const procedureSummarySchema = z.object({
  name: z.string(),
  args: z.string(),
});
export type ProcedureSummary = z.infer<typeof procedureSummarySchema>;

export const triggerSummarySchema = z.object({
  name: z.string(),
  tableSchema: z.string(),
  tableName: z.string(),
  enabled: z.boolean(),
});
export type TriggerSummary = z.infer<typeof triggerSummarySchema>;

export function schemaGetFunctionDefinition(
  connId: string,
  schema: string,
  fnName: string,
  fnArgs: string,
): Promise<FunctionDefinition> {
  return invokeChecked(
    "schema_get_function_definition",
    { connId, schema, fnName, fnArgs },
    functionDefinitionSchema,
  );
}

export function schemaGetProcedureDefinition(
  connId: string,
  schema: string,
  procName: string,
  procArgs: string,
): Promise<ProcedureDefinition> {
  return invokeChecked(
    "schema_get_procedure_definition",
    { connId, schema, procName, procArgs },
    procedureDefinitionSchema,
  );
}

export function schemaGetTriggerDefinition(
  connId: string,
  schema: string,
  table: string,
  triggerName: string,
): Promise<TriggerDefinition> {
  return invokeChecked(
    "schema_get_trigger_definition",
    { connId, schema, table, triggerName },
    triggerDefinitionSchema,
  );
}

export function schemaListFunctions(
  connId: string,
  schema: string,
  triggerOnly: boolean,
): Promise<FunctionSummary[]> {
  return invokeChecked(
    "schema_list_functions",
    { connId, schema, triggerOnly },
    z.array(functionSummarySchema),
  );
}

export function schemaListProcedures(connId: string, schema: string): Promise<ProcedureSummary[]> {
  return invokeChecked(
    "schema_list_procedures",
    { connId, schema },
    z.array(procedureSummarySchema),
  );
}

export function schemaListTriggers(
  connId: string,
  schema: string,
  table: string | null,
): Promise<TriggerSummary[]> {
  return invokeChecked(
    "schema_list_triggers",
    { connId, schema, table },
    z.array(triggerSummarySchema),
  );
}

// ---------------------------------------------------------------------------
// — FDW / Publication / Subscription / Role / Custom Type schemas.
// ---------------------------------------------------------------------------

export const qualifiedNameSchema = z.object({
  schema: z.string(),
  name: z.string(),
});
export type QualifiedNameDto = z.infer<typeof qualifiedNameSchema>;

export const kvOptionSchema = z.object({
  key: z.string(),
  value: z.string(),
});
export type KvOptionDto = z.infer<typeof kvOptionSchema>;

export const userMappingSchema = z.object({
  roleName: z.string(),
  options: z.array(kvOptionSchema),
});
export type UserMappingDto = z.infer<typeof userMappingSchema>;

export const fdwServerDefinitionSchema = z.object({
  name: z.string(),
  fdwName: z.string(),
  serverType: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  options: z.array(kvOptionSchema),
  userMappings: z.array(userMappingSchema),
  comment: z.string().nullable().optional(),
});
export type FdwServerDefinitionDto = z.infer<typeof fdwServerDefinitionSchema>;

export const publicationDefinitionSchema = z.object({
  name: z.string(),
  allTables: z.boolean(),
  schemas: z.array(z.string()),
  tables: z.array(qualifiedNameSchema),
  publishInsert: z.boolean(),
  publishUpdate: z.boolean(),
  publishDelete: z.boolean(),
  publishTruncate: z.boolean(),
  publishViaPartitionRoot: z.boolean(),
  comment: z.string().nullable().optional(),
});
export type PublicationDefinitionDto = z.infer<typeof publicationDefinitionSchema>;

export const publicationSummarySchema = z.object({
  name: z.string(),
  allTables: z.boolean(),
});
export type PublicationSummaryDto = z.infer<typeof publicationSummarySchema>;

export const subscriptionDefinitionSchema = z.object({
  name: z.string(),
  conninfo: z.string(),
  publications: z.array(z.string()),
  enabled: z.boolean(),
  copyData: z.boolean(),
  createSlot: z.boolean(),
  slotName: z.string().nullable().optional(),
  synchronousCommit: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});
export type SubscriptionDefinitionDto = z.infer<typeof subscriptionDefinitionSchema>;

export const roleDefinitionSchema = z.object({
  name: z.string(),
  login: z.boolean(),
  superuser: z.boolean(),
  createdb: z.boolean(),
  createrole: z.boolean(),
  replication: z.boolean(),
  bypassrls: z.boolean(),
  inherit: z.boolean(),
  connectionLimit: z.number().int(),
  validUntil: z.string().nullable().optional(),
  memberOf: z.array(z.string()),
  comment: z.string().nullable().optional(),
});
export type RoleDefinitionDto = z.infer<typeof roleDefinitionSchema>;

export const roleSummarySchema = z.object({
  name: z.string(),
  login: z.boolean(),
});
export type RoleSummaryDto = z.infer<typeof roleSummarySchema>;

export const enumTypeDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  values: z.array(z.string()),
  comment: z.string().nullable().optional(),
});
export type EnumTypeDefinitionDto = z.infer<typeof enumTypeDefinitionSchema>;

export const compositeFieldSchema = z.object({
  name: z.string(),
  typeText: z.string(),
  collation: z.string().nullable().optional(),
});
export const compositeTypeDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  fields: z.array(compositeFieldSchema),
  comment: z.string().nullable().optional(),
});
export type CompositeTypeDefinitionDto = z.infer<typeof compositeTypeDefinitionSchema>;

export const domainConstraintSchema = z.object({
  name: z.string().nullable().optional(),
  check: z.string(),
  notValid: z.boolean(),
});
export const domainTypeDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  baseType: z.string(),
  notNull: z.boolean(),
  default: z.string().nullable().optional(),
  constraints: z.array(domainConstraintSchema),
  collation: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});
export type DomainTypeDefinitionDto = z.infer<typeof domainTypeDefinitionSchema>;

export const rangeTypeDefinitionSchema = z.object({
  schema: z.string(),
  name: z.string(),
  subtype: z.string(),
  subtypeOpclass: z.string().nullable().optional(),
  collation: z.string().nullable().optional(),
  canonical: z.string().nullable().optional(),
  subtypeDiff: z.string().nullable().optional(),
  multirangeTypeName: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});
export type RangeTypeDefinitionDto = z.infer<typeof rangeTypeDefinitionSchema>;

export const customTypeDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enum") }).merge(enumTypeDefinitionSchema),
  z.object({ kind: z.literal("composite") }).merge(compositeTypeDefinitionSchema),
  z.object({ kind: z.literal("domain") }).merge(domainTypeDefinitionSchema),
  z.object({ kind: z.literal("range") }).merge(rangeTypeDefinitionSchema),
]);
export type CustomTypeDefinitionDto = z.infer<typeof customTypeDefinitionSchema>;

export async function schemaGetFdwServerDefinition(
  connId: string,
  serverName: string,
): Promise<FdwServerDefinitionDto> {
  return invokeChecked(
    "schema_get_fdw_server_definition",
    { connId, serverName },
    fdwServerDefinitionSchema,
  );
}

export async function schemaGetPublicationDefinition(
  connId: string,
  pubName: string,
): Promise<PublicationDefinitionDto> {
  return invokeChecked(
    "schema_get_publication_definition",
    { connId, pubName },
    publicationDefinitionSchema,
  );
}

export async function schemaGetSubscriptionDefinition(
  connId: string,
  subName: string,
): Promise<SubscriptionDefinitionDto> {
  return invokeChecked(
    "schema_get_subscription_definition",
    { connId, subName },
    subscriptionDefinitionSchema,
  );
}

export async function schemaGetRoleDefinition(
  connId: string,
  roleName: string,
): Promise<RoleDefinitionDto> {
  return invokeChecked("schema_get_role_definition", { connId, roleName }, roleDefinitionSchema);
}

export async function schemaGetCustomTypeDefinition(
  connId: string,
  schema: string,
  name: string,
): Promise<CustomTypeDefinitionDto> {
  return invokeChecked(
    "schema_get_custom_type_definition",
    { connId, schema, name },
    customTypeDefinitionSchema,
  );
}

export async function schemaListPublishableTables(connId: string): Promise<QualifiedNameDto[]> {
  return invokeChecked("schema_list_publishable_tables", { connId }, z.array(qualifiedNameSchema));
}

export async function schemaListPublications(connId: string): Promise<PublicationSummaryDto[]> {
  return invokeChecked("schema_list_publications", { connId }, z.array(publicationSummarySchema));
}

export async function schemaListCollations(connId: string): Promise<string[]> {
  return invokeChecked("schema_list_collations", { connId }, z.array(z.string()));
}

export async function schemaListRoles(connId: string): Promise<RoleSummaryDto[]> {
  return invokeChecked("schema_list_roles", { connId }, z.array(roleSummarySchema));
}

/**
 * Open an http(s) URL in the user's default browser. Backed by the Rust
 * `open_external_url` command (see `src-tauri/src/system.rs`) — Tauri 2 doesn't
 * route `window.open(url, "_blank")` to the OS browser by default, so the
 * "PostgreSQL docs" links in object editors silently did nothing without this.
 */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}
