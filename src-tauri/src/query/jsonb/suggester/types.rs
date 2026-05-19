//! — DTOs for the GIN Index Suggester.
//!
//! Mirrors the spec §5.2 (`jsonb_suggester_run`) — each variant is faithful to
//! the wire shape consumed by `lib/tauri.ts` zod schemas.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SuggesterScope {
    Global,
    Column {
        schema: String,
        table: String,
        column: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggesterRequest {
    pub conn_id: String,
    pub scope: SuggesterScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExtensionAvailability {
    Available,
    Unavailable {
        #[serde(rename = "installSql")]
        install_sql: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatus {
    pub pg_stat_statements: ExtensionAvailability,
    pub hypopg: ExtensionAvailability,
    pub generic_plan: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpClass {
    JsonbOps,
    JsonbPathOps,
    Expression { expr: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SuggestionRationale {
    Mined {
        calls: i64,
        #[serde(rename = "totalExecTimeMs")]
        total_exec_time_ms: f64,
        #[serde(rename = "opsSeen")]
        ops_seen: Vec<String>,
    },
    Generic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub op_class: OpClass,
    pub recommended_sql: String,
    pub index_name: String,
    pub rationale: SuggestionRationale,
    pub estimated_size_bytes: Option<u64>,
    pub representative_query: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggesterResult {
    pub extensions: ExtensionStatus,
    pub suggestions: Vec<Suggestion>,
    pub generated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HypoPgUnavailableReason {
    ExtensionMissing,
    PgVersionTooOld { actual: String, required: String },
    NoRepresentativeQuery,
    PlannerError { message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HypoPgEstimate {
    Computed {
        #[serde(rename = "baselineCost")]
        baseline_cost: f64,
        #[serde(rename = "hypotheticalCost")]
        hypothetical_cost: f64,
        #[serde(rename = "reductionPct")]
        reduction_pct: f32,
    },
    Unavailable {
        reason: HypoPgUnavailableReason,
    },
}

#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SuggesterError {
    #[error("not connected")]
    NotConnected,
    #[error("postgres error: {message}")]
    Postgres { message: String },
    #[error("internal: {message}")]
    Internal { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggester_result_roundtrip() {
        let original = SuggesterResult {
            extensions: ExtensionStatus {
                pg_stat_statements: ExtensionAvailability::Available,
                hypopg: ExtensionAvailability::Unavailable {
                    install_sql: "CREATE EXTENSION hypopg;".into(),
                },
                generic_plan: true,
            },
            suggestions: vec![Suggestion {
                schema: "public".into(),
                table: "events".into(),
                column: "data".into(),
                op_class: OpClass::JsonbPathOps,
                recommended_sql: "CREATE INDEX …".into(),
                index_name: "idx_events_data_gin".into(),
                rationale: SuggestionRationale::Mined {
                    calls: 1234,
                    total_exec_time_ms: 8400.0,
                    ops_seen: vec!["@>".into(), "@?".into()],
                },
                estimated_size_bytes: Some(85_000_000),
                representative_query: Some("SELECT * FROM events WHERE data @> $1".into()),
            }],
            generated_at: 1_714_300_000_000,
        };
        let s = serde_json::to_string(&original).unwrap();
        let back: SuggesterResult = serde_json::from_str(&s).unwrap();
        assert_eq!(original, back);
    }

    #[test]
    fn hypopg_estimate_roundtrip() {
        let computed = HypoPgEstimate::Computed {
            baseline_cost: 12450.0,
            hypothetical_cost: 380.0,
            reduction_pct: 96.95,
        };
        let s = serde_json::to_string(&computed).unwrap();
        let back: HypoPgEstimate = serde_json::from_str(&s).unwrap();
        assert_eq!(computed, back);

        let unavailable = HypoPgEstimate::Unavailable {
            reason: HypoPgUnavailableReason::ExtensionMissing,
        };
        let s = serde_json::to_string(&unavailable).unwrap();
        let back: HypoPgEstimate = serde_json::from_str(&s).unwrap();
        assert_eq!(unavailable, back);
    }

    #[test]
    fn rationale_generic_roundtrip_and_wire_shape() {
        let g = SuggestionRationale::Generic;
        let s = serde_json::to_string(&g).unwrap();
        assert_eq!(s, r#"{"kind":"generic"}"#);
        let back: SuggestionRationale = serde_json::from_str(&s).unwrap();
        assert_eq!(g, back);
    }

    #[test]
    fn op_class_unit_variants_roundtrip_and_wire_shape() {
        let jo = serde_json::to_string(&OpClass::JsonbOps).unwrap();
        assert_eq!(jo, r#"{"kind":"jsonbOps"}"#);
        let jpo = serde_json::to_string(&OpClass::JsonbPathOps).unwrap();
        assert_eq!(jpo, r#"{"kind":"jsonbPathOps"}"#);

        let back_jo: OpClass = serde_json::from_str(&jo).unwrap();
        assert_eq!(back_jo, OpClass::JsonbOps);
        let back_path_ops: OpClass = serde_json::from_str(&jpo).unwrap();
        assert_eq!(back_path_ops, OpClass::JsonbPathOps);
    }

    #[test]
    fn op_class_expression_roundtrip() {
        let e = OpClass::Expression {
            expr: "(data->>'k')".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        let back: OpClass = serde_json::from_str(&s).unwrap();
        assert_eq!(e, back);
    }

    #[test]
    fn extension_availability_unavailable_roundtrip() {
        let u = ExtensionAvailability::Unavailable {
            install_sql: "CREATE EXTENSION x;".into(),
        };
        let s = serde_json::to_string(&u).unwrap();
        let back: ExtensionAvailability = serde_json::from_str(&s).unwrap();
        assert_eq!(u, back);
    }

    #[test]
    fn hypopg_unavailable_reasons_roundtrip() {
        for reason in [
            HypoPgUnavailableReason::ExtensionMissing,
            HypoPgUnavailableReason::PgVersionTooOld {
                actual: "14.7".into(),
                required: "16".into(),
            },
            HypoPgUnavailableReason::NoRepresentativeQuery,
            HypoPgUnavailableReason::PlannerError {
                message: "boom".into(),
            },
        ] {
            let s = serde_json::to_string(&reason).unwrap();
            let back: HypoPgUnavailableReason = serde_json::from_str(&s).unwrap();
            assert_eq!(reason, back);
        }
    }

    // ── Wire-shape lockdown tests (/) ───────────────

    #[test]
    fn extension_unavailable_install_sql_is_camel_case() {
        // install_sql must serialize as "installSql" on the wire.
        let v = ExtensionAvailability::Unavailable {
            install_sql: "CREATE EXTENSION hypopg;".into(),
        };
        let s = serde_json::to_string(&v).unwrap();
        assert!(            s.contains("\"installSql\""),
            "field must serialize as installSql, got: {s}"
);
        assert!(            !s.contains("\"install_sql\""),
            "snake_case must NOT appear on wire, got: {s}"
);
        // Roundtrip with camelCase shape.
        let back: ExtensionAvailability = serde_json::from_str(&s).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn suggestion_rationale_mined_fields_are_camel_case() {
        // total_exec_time_ms → totalExecTimeMs, ops_seen → opsSeen.
        let v = SuggestionRationale::Mined {
            calls: 42,
            total_exec_time_ms: 123.4,
            ops_seen: vec!["@>".into()],
        };
        let s = serde_json::to_string(&v).unwrap();
        assert!(            s.contains("\"totalExecTimeMs\""),
            "field must serialize as totalExecTimeMs, got: {s}"
);
        assert!(            s.contains("\"opsSeen\""),
            "field must serialize as opsSeen, got: {s}"
);
        assert!(            !s.contains("\"total_exec_time_ms\""),
            "snake_case must NOT appear on wire, got: {s}"
);
        assert!(            !s.contains("\"ops_seen\""),
            "snake_case must NOT appear on wire, got: {s}"
);
        // Roundtrip.
        let back: SuggestionRationale = serde_json::from_str(&s).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn hypopg_estimate_computed_fields_are_camel_case() {
        // baseline_cost → baselineCost, etc.
        let v = HypoPgEstimate::Computed {
            baseline_cost: 1000.0,
            hypothetical_cost: 50.0,
            reduction_pct: 95.0,
        };
        let s = serde_json::to_string(&v).unwrap();
        assert!(            s.contains("\"baselineCost\""),
            "field must serialize as baselineCost, got: {s}"
);
        assert!(            s.contains("\"hypotheticalCost\""),
            "field must serialize as hypotheticalCost, got: {s}"
);
        assert!(            s.contains("\"reductionPct\""),
            "field must serialize as reductionPct, got: {s}"
);
        assert!(            !s.contains("\"baseline_cost\""),
            "snake_case must NOT appear on wire, got: {s}"
);
        // Roundtrip.
        let back: HypoPgEstimate = serde_json::from_str(&s).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn suggester_result_roundtrip_after_rename() {
        // Ensure the existing mined-rationale roundtrip still passes after the
        // serde rename additions.  Serialises from Rust → deserialises back;
        // both sides use the renamed fields so the invariant must hold.
        let original = SuggesterResult {
            extensions: ExtensionStatus {
                pg_stat_statements: ExtensionAvailability::Available,
                hypopg: ExtensionAvailability::Unavailable {
                    install_sql: "CREATE EXTENSION hypopg;".into(),
                },
                generic_plan: false,
            },
            suggestions: vec![Suggestion {
                schema: "public".into(),
                table: "orders".into(),
                column: "payload".into(),
                op_class: OpClass::JsonbOps,
                recommended_sql: "CREATE INDEX …".into(),
                index_name: "idx_orders_payload_gin".into(),
                rationale: SuggestionRationale::Mined {
                    calls: 99,
                    total_exec_time_ms: 8400.0,
                    ops_seen: vec!["@>".into(), "@?".into()],
                },
                estimated_size_bytes: None,
                representative_query: None,
            }],
            generated_at: 1_714_300_000_001,
        };
        let s = serde_json::to_string(&original).unwrap();
        let back: SuggesterResult = serde_json::from_str(&s).unwrap();
        assert_eq!(original, back);
    }
}
