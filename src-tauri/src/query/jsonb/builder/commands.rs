//! Tauri command surface for the JSONB Query Builder.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use crate::query::jsonb::builder::types::{BuilderError, BuilderPreview, BuilderRequest};

#[tauri::command]
pub async fn jsonb_builder_preview(req: BuilderRequest) -> Result<BuilderPreview, BuilderError> {
    crate::query::jsonb::builder::sql_gen::generate(&req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::jsonb::builder::types::{BuilderOp, BuilderValue};
    use crate::query::jsonb::inference::types::{FullyQualifiedColumn, PathSegment};

    #[tokio::test]
    async fn command_returns_sql_for_existence() {
        let req = BuilderRequest {
            conn_id: "c1".into(),
            fqn: FullyQualifiedColumn {
                schema: "public".into(),
                table: "events".into(),
                column: "data".into(),
            },
            op: BuilderOp::Existence,
            path: vec![PathSegment::Key("active".into())],
            value: BuilderValue::None,
        };
        let result = jsonb_builder_preview(req).await;
        let preview = result.unwrap();
        assert!(preview.sql.contains("? 'active'"), "sql: {}", preview.sql);
    }

    #[tokio::test]
    async fn command_returns_error_for_invalid_json() {
        let req = BuilderRequest {
            conn_id: "c1".into(),
            fqn: FullyQualifiedColumn {
                schema: "public".into(),
                table: "events".into(),
                column: "data".into(),
            },
            op: BuilderOp::Containment,
            path: vec![],
            value: BuilderValue::JsonLiteral {
                value: "not json".into(),
            },
        };
        assert!(matches!(            jsonb_builder_preview(req).await,
            Err(BuilderError::InvalidJson { .. })
));
    }
}
