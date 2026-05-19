//! Public types exposed to the frontend and shared between `ddl.rs` / `select.rs`.

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DdlChange {
    CreateTable {
        schema: String,
        name: String,
        columns: Vec<ColumnDef>,
        primary_key: Vec<String>,
    },
    DropTable {
        schema: String,
        name: String,
    },
    RenameTable {
        schema: String,
        old_name: String,
        new_name: String,
    },
    AddColumn {
        schema: String,
        table: String,
        column: ColumnDef,
    },
    DropColumn {
        schema: String,
        table: String,
        column: String,
    },
    RenameColumn {
        schema: String,
        table: String,
        old_name: String,
        new_name: String,
    },
    AlterColumnType {
        schema: String,
        table: String,
        column: String,
        new_type: String,
    },
    AlterColumnNullable {
        schema: String,
        table: String,
        column: String,
        nullable: bool,
    },
    AddPrimaryKey {
        schema: String,
        table: String,
        columns: Vec<String>,
    },
    AddForeignKey {
        schema: String,
        table: String,
        name: Option<String>,
        columns: Vec<String>,
        ref_schema: String,
        ref_table: String,
        ref_columns: Vec<String>,
    },
    DropConstraint {
        schema: String,
        table: String,
        constraint: String,
    },
    Unrepresentable {
        sql_snippet: String,
        reason: String,
    },
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub identity: bool,
    pub is_primary_key: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DdlParseResult {
    pub changes: Vec<DdlChange>,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryShape {
    pub base_select: BaseSelect,
    pub filters: Vec<Filter>,
    pub sort: Option<Sort>,
    pub limit: Option<i64>,
    pub unrepresentable_tail: Option<String>,
    pub where_span: Option<ClauseSpan>,
    pub order_by_span: Option<ClauseSpan>,
    pub limit_span: Option<ClauseSpan>,
    pub from_end: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BaseSelect {
    pub schema: Option<String>,
    pub table: String,
    pub columns: Vec<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column: String,
    pub op: FilterOp,
    pub value: Option<serde_json::Value>,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Like,
    IsNull,
    IsNotNull,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sort {
    pub column: String,
    pub dir: SortDir,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SortDir {
    Asc,
    Desc,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClauseSpan {
    pub start: u32,
    pub end: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq, thiserror::Error)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct ParseError {
    pub message: String,
    pub line: u32,
    pub column: u32,
}
