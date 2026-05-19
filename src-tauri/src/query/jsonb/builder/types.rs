//! — DTOs for the JSONB Query Builder.
//!
//! All types are `Serialize + Deserialize` so they round-trip through Tauri
//! IPC. `camelCase` on the wire (Rust uses `snake_case` via `serde(rename_all)`).

use serde::{Deserialize, Serialize};

use crate::query::jsonb::inference::types::{FullyQualifiedColumn, PathSegment};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BuilderOp {
    Existence,
    Containment,
    PathExtract {
        mode: ExtractMode,
    },
    PathPredicate {
        comparator: Comparator,
        rhs: BuilderValue,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExtractMode {
    Projection,
    Comparison {
        #[serde(rename = "eqValue")]
        eq_value: BuilderValue,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Comparator {
    Eq,
    Ne,
    Gt,
    Lt,
    Ge,
    Le,
    LikeRegex,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BuilderValue {
    None,
    String { value: String },
    Number { value: String },
    Bool { value: bool },
    Null,
    JsonLiteral { value: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuilderRequest {
    pub conn_id: String,
    pub fqn: FullyQualifiedColumn,
    pub op: BuilderOp,
    pub path: Vec<PathSegment>,
    pub value: BuilderValue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BuilderWarning {
    ExistenceTopLevel,
    PathTooDeep { limit: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuilderPreview {
    pub sql: String,
    pub warnings: Vec<BuilderWarning>,
}

#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BuilderError {
    #[error("invalid JSON: {message}")]
    InvalidJson { message: String },
    #[error("type mismatch: expected {expected}, got {got}")]
    TypeMismatch { expected: String, got: String },
    #[error("path too deep (limit {limit})")]
    PathTooDeep { limit: u32 },
    #[error("internal: {message}")]
    Internal { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::jsonb::inference::types::{FullyQualifiedColumn, PathSegment};

    #[test]
    fn builder_request_roundtrip() {
        let original = BuilderRequest {
            conn_id: "c1".into(),
            fqn: FullyQualifiedColumn {
                schema: "public".into(),
                table: "events".into(),
                column: "data".into(),
            },
            op: BuilderOp::Containment,
            path: vec![PathSegment::Key("user".into())],
            value: BuilderValue::String {
                value: "alice".into(),
            },
        };
        let s = serde_json::to_string(&original).unwrap();
        let back: BuilderRequest = serde_json::from_str(&s).unwrap();
        assert_eq!(original, back);
    }

    #[test]
    fn builder_preview_roundtrip() {
        let original = BuilderPreview {
            sql: "SELECT 1".into(),
            warnings: vec![BuilderWarning::ExistenceTopLevel],
        };
        let s = serde_json::to_string(&original).unwrap();
        let back: BuilderPreview = serde_json::from_str(&s).unwrap();
        assert_eq!(original, back);
    }

    #[test]
    fn builder_value_unit_variants_roundtrip() {
        for variant in [BuilderValue::None, BuilderValue::Null] {
            let s = serde_json::to_string(&variant).unwrap();
            let back: BuilderValue = serde_json::from_str(&s).unwrap();
            assert_eq!(variant, back);
        }
    }

    #[test]
    fn builder_value_none_serializes_as_kind_only() {
        // Wire shape contract for the frontend zod schema:
        // BuilderValue::None  →  {"kind":"none"}
        // BuilderValue::Null  →  {"kind":"null"}
        let none = serde_json::to_string(&BuilderValue::None).unwrap();
        assert_eq!(none, r#"{"kind":"none"}"#);
        let null = serde_json::to_string(&BuilderValue::Null).unwrap();
        assert_eq!(null, r#"{"kind":"null"}"#);
    }

    // ── Wire-shape lockdown tests () ──────────────────────────────

    #[test]
    fn extract_mode_comparison_eq_value_is_camel_case() {
        // eq_value must serialize as "eqValue" on the wire.
        let v = ExtractMode::Comparison {
            eq_value: BuilderValue::String { value: "x".into() },
        };
        let s = serde_json::to_string(&v).unwrap();
        assert!(            s.contains("\"eqValue\""),
            "field must serialize as eqValue, got: {s}"
);
        assert!(            !s.contains("\"eq_value\""),
            "snake_case must NOT appear on wire, got: {s}"
);
        // Roundtrip: frontend sends camelCase, backend must deserialize it.
        let back: ExtractMode = serde_json::from_str(&s).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn extract_mode_comparison_rejects_snake_case_on_wire() {
        // If frontend erroneously sends eq_value (snake), deserialization must fail.
        let snake_json = r#"{"kind":"comparison","eq_value":{"kind":"null"}}"#;
        let result: Result<ExtractMode, _> = serde_json::from_str(snake_json);
        assert!(            result.is_err(),
            "snake_case eq_value must NOT deserialize successfully"
);
    }
}
