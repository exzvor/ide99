//! DTOs for JSONB schema inference.
//!
//! All types are `Serialize + Deserialize` so they round-trip through
//! `SQLite` blobs (cache) and Tauri IPC (frontend). camelCase on the wire.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullyQualifiedColumn {
    pub schema: String,
    pub table: String,
    pub column: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PathSegment {
    Key(String),
    ArrayWildcard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Primitive {
    String,
    Number,
    Boolean,
    Null,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProbableType {
    Primitive { value: Primitive },
    Enum { values: Vec<String> },
    Object,
    Array { element: Box<ProbableType> },
    Union { variants: Vec<ProbableType> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferredNode {
    pub path: Vec<PathSegment>,
    pub kind: ProbableType,
    pub freq: f32,
    pub samples: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferredSchema {
    pub nodes: Vec<InferredNode>,
    pub sample_count: u32,
    pub generated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStats {
    pub n_tup_ins: i64,
    pub n_tup_upd: i64,
    pub n_tup_del: i64,
    pub n_live_tup: i64,
}

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InferenceError {
    #[error("inference query timed out after 5s")]
    Timeout,
    #[error("postgres error: {message}")]
    Postgres { message: String },
    #[error("sqlite error: {message}")]
    Sqlite { message: String },
    #[error("not connected")]
    NotConnected,
    #[error("column is not jsonb/json")]
    NotJsonb,
    #[error("internal: {message}")]
    Internal { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_roundtrip_through_json() {
        let original = InferredSchema {
            nodes: vec![InferredNode {
                path: vec![PathSegment::Key("user".into()), PathSegment::ArrayWildcard],
                kind: ProbableType::Enum {
                    values: vec!["a".into(), "b".into()],
                },
                freq: 0.42,
                samples: vec![serde_json::json!("a"), serde_json::json!(42)],
            }],
            sample_count: 100,
            generated_at: 1_714_000_000_000,
        };
        let s = serde_json::to_string(&original).unwrap();
        let back: InferredSchema = serde_json::from_str(&s).unwrap();
        assert_eq!(original, back);
    }

    #[test]
    fn empty_schema_roundtrip() {
        let original = InferredSchema {
            nodes: vec![],
            sample_count: 0,
            generated_at: 0,
        };
        let s = serde_json::to_string(&original).unwrap();
        let back: InferredSchema = serde_json::from_str(&s).unwrap();
        assert_eq!(original, back);
    }
}
