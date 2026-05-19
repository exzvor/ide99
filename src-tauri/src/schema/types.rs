//! Schema introspection DTOs. All fields camelCase on the wire.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectInfo {
    pub server_version: String,
    pub database: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewInfo {
    pub name: String,
    pub definition: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub comment: Option<String>,
    pub ordinal: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub method: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub name: String,
    pub definition: String,
    pub referenced_schema: String,
    pub referenced_table: String,
}

/// One relation (table / view / matview) returned from the autocomplete snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutocompleteRelation {
    pub schema: String,
    pub name: String,
    pub kind: AutocompleteRelKind,
    pub columns: Vec<AutocompleteColumn>,
}

/// One column inside a relation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutocompleteColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_jsonb: bool,
}

/// Discriminator for relation kinds. JSON form: "table" | "view" | "matview".
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AutocompleteRelKind {
    Table,
    View,
    Matview,
}

/// Top-level snapshot returned by `schema_get_autocomplete_snapshot`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutocompleteSnapshot {
    pub conn_id: String,
    /// `search_path` with `$user` substituted, empties dropped, order preserved, deduped.
    pub search_path: Vec<String>,
    pub relations: Vec<AutocompleteRelation>,
    /// Epoch milliseconds for "last fetched"; the frontend uses it for staleness debugging only.
    pub loaded_at: i64,
}

// ---------------------------------------------------------------------------
// — full-detail introspection DTOs.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableDefinition {
    pub schema: String,
    pub name: String,
    pub comment: Option<String>,
    pub columns: Vec<ColumnDefinition>,
    pub constraints: Vec<ConstraintDefinition>,
    pub indexes: Vec<IndexDefinition>,
    pub rls_enabled: bool,
    pub partition: Option<PartitionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDefinition {
    pub name: String,
    pub type_text: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub generated: Option<GeneratedColumn>,
    pub comment: Option<String>,
    pub ordinal: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedColumn {
    /// Currently always "stored"; PG14+ may add "virtual" later.
    pub kind: String,
    pub expression: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintDefinition {
    pub name: String,
    /// "pk" | "unique" | "fk" | "check"
    pub kind: String,
    /// `pg_get_constraintdef(con.oid)` — verbatim Postgres-rendered body.
    pub definition: String,
    pub columns: Vec<String>,
    pub ref_schema: Option<String>,
    pub ref_table: Option<String>,
    pub ref_columns: Vec<String>,
    pub expression: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexDefinition {
    pub schema: String,
    pub name: String,
    pub table: String,
    pub method: String,
    pub unique: bool,
    pub primary: bool,
    pub columns: Vec<String>,
    pub include: Vec<String>,
    pub predicate: Option<String>,
    /// `pg_get_indexdef(idx.indexrelid)` — verbatim DDL.
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewDefinition {
    pub schema: String,
    pub name: String,
    pub body: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MatviewDefinition {
    pub schema: String,
    pub name: String,
    pub body: String,
    pub populated: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceDefinition {
    pub schema: String,
    pub name: String,
    /// "smallint" | "integer" | "bigint"
    pub data_type: String,
    pub start: i64,
    pub increment: i64,
    pub min_value: i64,
    pub max_value: i64,
    pub cache: i64,
    pub cycle: bool,
    pub owned_by: Option<SequenceOwnedBy>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceOwnedBy {
    pub schema: String,
    pub table: String,
    pub column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PartitionInfo {
    /// "range" | "list" | "hash"
    pub strategy: String,
    /// `pg_get_partkeydef(c.oid)` body.
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MatviewSummary {
    pub name: String,
    pub populated: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceSummary {
    pub name: String,
    pub data_type: String,
}

// ---------------------------------------------------------------------------
// — function / procedure / trigger introspection DTOs.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FunctionDefinition {
    pub schema: String,
    pub name: String,
    pub language: String,
    pub parameters: Vec<FunctionParameter>,
    /// "scalar" | "setof" | "trigger" | "void"
    pub return_kind: String,
    pub return_type: Option<String>,
    pub body: String,
    /// "volatile" | "stable" | "immutable"
    pub volatility: String,
    /// "unsafe" | "restricted" | "safe"
    pub parallel_safety: String,
    pub security_definer: bool,
    pub cost: Option<f64>,
    pub estimated_rows: Option<f64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FunctionParameter {
    pub name: String,
    /// "in" | "out" | "inout" | "variadic"
    pub mode: String,
    pub type_text: String,
    pub default: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcedureDefinition {
    pub schema: String,
    pub name: String,
    pub language: String,
    pub parameters: Vec<FunctionParameter>,
    pub body: String,
    pub security_definer: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TriggerDefinition {
    pub schema: String,
    pub name: String,
    pub table_schema: String,
    pub table_name: String,
    /// "before" | "after" | "instead_of"
    pub timing: String,
    pub events: TriggerEvents,
    /// columns listed in UPDATE OF (...) — empty when not UPDATE or unrestricted
    pub update_columns: Vec<String>,
    /// "row" | "statement"
    pub for_each: String,
    pub when_clause: Option<String>,
    pub function_schema: String,
    pub function_name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TriggerEvents {
    pub insert: bool,
    pub update: bool,
    pub delete: bool,
    pub truncate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FunctionSummary {
    pub name: String,
    /// `pg_get_function_arguments(oid)` — used as part of the unique identifier.
    pub args: String,
    /// "scalar" | "setof" | "trigger" | "void"
    pub return_kind: String,
    pub return_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcedureSummary {
    pub name: String,
    pub args: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TriggerSummary {
    pub name: String,
    pub table_schema: String,
    pub table_name: String,
    pub enabled: bool,
}

// ---------------------------------------------------------------------------
// — FDW / Publication / Subscription / Role / Custom Type DTOs.
// ---------------------------------------------------------------------------

/// Schema-qualified object name (used by Publication's table list and elsewhere).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QualifiedName {
    pub schema: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KvOption {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserMapping {
    /// "PUBLIC" or an actual role name.
    pub role_name: String,
    pub options: Vec<KvOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FdwServerDefinition {
    pub name: String,
    pub fdw_name: String,
    pub server_type: Option<String>,
    pub version: Option<String>,
    pub options: Vec<KvOption>,
    pub user_mappings: Vec<UserMapping>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FdwServerSummary {
    pub name: String,
    pub fdw_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationDefinition {
    pub name: String,
    pub all_tables: bool,
    pub schemas: Vec<String>,
    pub tables: Vec<QualifiedName>,
    pub publish_insert: bool,
    pub publish_update: bool,
    pub publish_delete: bool,
    pub publish_truncate: bool,
    pub publish_via_partition_root: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationSummary {
    pub name: String,
    pub all_tables: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionDefinition {
    pub name: String,
    /// `pg_subscription.subconninfo` — kept verbatim (PG stores password in plain text).
    pub conninfo: String,
    pub publications: Vec<String>,
    pub enabled: bool,
    pub copy_data: bool,
    pub create_slot: bool,
    pub slot_name: Option<String>,
    pub synchronous_commit: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionSummary {
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleDefinition {
    pub name: String,
    pub login: bool,
    pub superuser: bool,
    pub createdb: bool,
    pub createrole: bool,
    pub replication: bool,
    pub bypassrls: bool,
    pub inherit: bool,
    /// `rolconnlimit` from pg_authid. -1 = no limit.
    pub connection_limit: i32,
    pub valid_until: Option<String>,
    pub member_of: Vec<String>,
    pub comment: Option<String>,
    // Note: password hash is NEVER serialized.
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleSummary {
    pub name: String,
    pub login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnumTypeDefinition {
    pub schema: String,
    pub name: String,
    pub values: Vec<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompositeField {
    pub name: String,
    pub type_text: String,
    pub collation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompositeTypeDefinition {
    pub schema: String,
    pub name: String,
    pub fields: Vec<CompositeField>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DomainConstraint {
    pub name: Option<String>,
    pub check: String,
    pub not_valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DomainTypeDefinition {
    pub schema: String,
    pub name: String,
    pub base_type: String,
    pub not_null: bool,
    pub default: Option<String>,
    pub constraints: Vec<DomainConstraint>,
    pub collation: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RangeTypeDefinition {
    pub schema: String,
    pub name: String,
    pub subtype: String,
    pub subtype_opclass: Option<String>,
    pub collation: Option<String>,
    pub canonical: Option<String>,
    pub subtype_diff: Option<String>,
    pub multirange_type_name: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CustomTypeDefinition {
    Enum(EnumTypeDefinition),
    Composite(CompositeTypeDefinition),
    Domain(DomainTypeDefinition),
    Range(RangeTypeDefinition),
}
