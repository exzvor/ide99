//! `.ide99` envelope encode/decode + version + kind validation.
//!
//! Pure JSON helpers — write_to_path/read_from_path live in `commands.rs`.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use chrono::Utc;

use crate::file_sharing::types::{
    ImportPreview, ShareEnvelope, ShareError, ShareKind, SHARE_FORMAT_VERSION,
};

/// Build envelope from a per-kind payload.
pub fn encode(kind: ShareKind, payload: serde_json::Value) -> Result<String, ShareError> {
    let env = ShareEnvelope {
        version: SHARE_FORMAT_VERSION,
        kind,
        exported_at: Utc::now().to_rfc3339(),
        payload,
    };
    serde_json::to_string_pretty(&env).map_err(|e| ShareError::InvalidFile(format!("encode: {e}")))
}

/// Parse + validate an envelope (version + recognized kind).
pub fn decode(raw: &str) -> Result<ShareEnvelope, ShareError> {
    let env: ShareEnvelope =
        serde_json::from_str(raw).map_err(|e| ShareError::InvalidFile(format!("decode: {e}")))?;
    if env.version > SHARE_FORMAT_VERSION {
        return Err(ShareError::UnsupportedVersion {
            got: env.version,
            max: SHARE_FORMAT_VERSION,
        });
    }
    Ok(env)
}

/// Build an `ImportPreview` for the merge / replace modal — calls into the
/// per-kind serializer's `summary()` helper.
pub fn preview(env: &ShareEnvelope) -> Result<ImportPreview, ShareError> {
    use crate::file_sharing::kinds;
    let summary = match env.kind {
        ShareKind::Connection => kinds::connection::summary(&env.payload)?,
        ShareKind::ConnectionBundle => kinds::connection::bundle_summary(&env.payload)?,
        ShareKind::Snippet => kinds::snippet::summary(&env.payload)?,
        ShareKind::SnippetBundle => kinds::snippet::bundle_summary(&env.payload)?,
        ShareKind::Query => kinds::query::summary(&env.payload)?,
        ShareKind::Notebook => kinds::notebook::summary(&env.payload)?,
        ShareKind::MigrationSet => kinds::migration_set::summary(&env.payload)?,
        ShareKind::ErdLayout => kinds::erd_layout::summary(&env.payload)?,
        ShareKind::Theme => kinds::theme::summary(&env.payload)?,
        ShareKind::Keymap => kinds::keymap::summary(&env.payload)?,
        ShareKind::HealthConfig => kinds::health_config::summary(&env.payload)?,
    };
    let may_collide = matches!(
        env.kind,
        ShareKind::Connection
            | ShareKind::ConnectionBundle
            | ShareKind::Snippet
            | ShareKind::SnippetBundle
            | ShareKind::Theme
            | ShareKind::Keymap
            | ShareKind::MigrationSet
            | ShareKind::HealthConfig
    );
    Ok(ImportPreview {
        kind: env.kind,
        version: env.version,
        exported_at: env.exported_at.clone(),
        summary,
        may_collide,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_roundtrip() {
        let raw = encode(ShareKind::Connection, serde_json::json!({"name":"x"})).unwrap();
        let env = decode(&raw).unwrap();
        assert_eq!(env.version, SHARE_FORMAT_VERSION);
        assert_eq!(env.kind, ShareKind::Connection);
    }

    #[test]
    fn decode_rejects_future_version() {
        let raw = r#"{"version":99,"kind":"connection","exportedAt":"x","payload":{}}"#;
        let err = decode(raw).expect_err("must reject");
        assert!(matches!(err, ShareError::UnsupportedVersion { .. }));
    }

    #[test]
    fn decode_rejects_malformed_json() {
        let err = decode("{not json}").expect_err("must reject");
        assert!(matches!(err, ShareError::InvalidFile(_)));
    }

    #[test]
    fn decode_rejects_unknown_kind() {
        let raw = r#"{"version":1,"kind":"telegram","exportedAt":"x","payload":{}}"#;
        let err = decode(raw).expect_err("must reject");
        assert!(matches!(err, ShareError::InvalidFile(_)));
    }
}
