//! — DTOs for the ERD auto-layout payload.
//!
//! All types are `Serialize + Deserialize` so they round-trip through
//! Tauri IPC. camelCase on the wire (Rust uses snake_case via
//! `serde(rename_all)`).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErdColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub ordinal: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErdTable {
    pub schema: String,
    pub name: String,
    pub columns: Vec<ErdColumn>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErdForeignKey {
    pub name: String,
    pub source_schema: String,
    pub source_table: String,
    pub source_columns: Vec<String>,
    pub target_schema: String,
    pub target_table: String,
    pub target_columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErdSchemaGraph {
    pub tables: Vec<ErdTable>,
    pub foreign_keys: Vec<ErdForeignKey>,
    /// Wall-clock ms it took the backend to materialize this payload —
    /// surfaced in the canvas footer for transparency / debugging perf.
    pub fetched_in_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_roundtrips_through_serde_json() {
        let graph = ErdSchemaGraph {
            tables: vec![ErdTable {
                schema: "public".into(),
                name: "users".into(),
                columns: vec![ErdColumn {
                    name: "id".into(),
                    data_type: "bigint".into(),
                    nullable: false,
                    is_primary_key: true,
                    is_foreign_key: false,
                    ordinal: 1,
                }],
            }],
            foreign_keys: vec![ErdForeignKey {
                name: "orders_user_id_fkey".into(),
                source_schema: "public".into(),
                source_table: "orders".into(),
                source_columns: vec!["user_id".into()],
                target_schema: "public".into(),
                target_table: "users".into(),
                target_columns: vec!["id".into()],
            }],
            fetched_in_ms: 17,
        };
        let json = serde_json::to_string(&graph).expect("serialize");
        let back: ErdSchemaGraph = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(graph, back);
        assert!(json.contains("isPrimaryKey"));
        assert!(json.contains("sourceColumns"));
        assert!(json.contains("fetchedInMs"));
    }
}
