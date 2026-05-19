//! Connection / connection-bundle export & import for the `.ide99` envelope.
//!
//! **Privacy red line**: credentials
//! NEVER cross the file. `to_payload` strips `password`/`has_password`/
//! `last_tested_at`/`last_test_ok`; importer always lands the connection
//! with `has_password = false` and the user supplies credentials locally.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use serde::{Deserialize, Serialize};

use crate::connection::types::{Connection, Environment, SslMode};
use crate::file_sharing::types::ShareError;

/// Stripped connection-shape that lives in the envelope. Mirror of
/// `Connection` minus credential / runtime fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub ssl_mode: SslMode,
    pub environment: Environment,
    #[serde(default)]
    pub exclude_from_history: bool,
    #[serde(default)]
    pub exclude_from_recent_plans: bool,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub slow_query_warning: bool,
    #[serde(default)]
    pub confirm_destructive: bool,
}

impl From<&Connection> for ExportedConnection {
    fn from(c: &Connection) -> Self {
        Self {
            name: c.name.clone(),
            host: c.host.clone(),
            port: c.port,
            database: c.database.clone(),
            username: c.username.clone(),
            ssl_mode: c.ssl_mode,
            environment: c.environment,
            exclude_from_history: c.exclude_from_history,
            exclude_from_recent_plans: c.exclude_from_recent_plans,
            read_only: c.read_only,
            slow_query_warning: c.slow_query_warning,
            confirm_destructive: c.confirm_destructive,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionBundle {
    pub name: String,
    pub connections: Vec<ExportedConnection>,
}

pub fn to_single_payload(c: &Connection) -> Result<serde_json::Value, ShareError> {
    serde_json::to_value(ExportedConnection::from(c))
        .map_err(|e| ShareError::InvalidFile(format!("encode connection: {e}")))
}

pub fn to_bundle_payload(    name: &str,
    connections: &[Connection],
) -> Result<serde_json::Value, ShareError> {
    let bundle = ConnectionBundle {
        name: name.to_string(),
        connections: connections.iter().map(ExportedConnection::from).collect(),
    };
    serde_json::to_value(bundle).map_err(|e| ShareError::InvalidFile(format!("encode bundle: {e}")))
}

pub fn from_single_payload(value: &serde_json::Value) -> Result<ExportedConnection, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode connection: {e}")))
}

pub fn from_bundle_payload(value: &serde_json::Value) -> Result<ConnectionBundle, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode bundle: {e}")))
}

/// Human-readable summary for the import preview.
pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let c = from_single_payload(value)?;
    Ok(format!(        "{} ({}:{} / {})",
        c.name, c.host, c.port, c.database
))
}

pub fn bundle_summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let b = from_bundle_payload(value)?;
    Ok(format!("{} ({} connections)", b.name, b.connections.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::types::{Connection, Environment, SslMode};

    fn fake_conn(name: &str) -> Connection {
        Connection {
            id: format!("id-{name}"),
            name: name.to_string(),
            host: "db.example.com".into(),
            port: 5432,
            database: "myapp".into(),
            username: "alice".into(),
            ssl_mode: SslMode::Require,
            has_password: true,
            created_at: "2026-05-07T00:00:00Z".into(),
            updated_at: "2026-05-07T00:00:00Z".into(),
            last_tested_at: Some("2026-05-07T01:00:00Z".into()),
            last_test_ok: Some(true),
            exclude_from_history: false,
            exclude_from_recent_plans: false,
            environment: Environment::Prod,
            read_only: true,
            slow_query_warning: true,
            confirm_destructive: true,
            migrations_dir: None,
            migration_tracking_enabled: true,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: true,
        }
    }

    #[test]
    fn exported_connection_strips_credentials_and_runtime_state() {
        let c = fake_conn("prod");
        let exported = ExportedConnection::from(&c);
        let raw = serde_json::to_string(&exported).unwrap();
        assert!(!raw.contains("hasPassword"));
        assert!(!raw.contains("lastTestedAt"));
        assert!(!raw.contains("lastTestOk"));
        assert!(!raw.contains("password"));
    }

    #[test]
    fn roundtrip_single() {
        let c = fake_conn("prod");
        let payload = to_single_payload(&c).unwrap();
        let parsed = from_single_payload(&payload).unwrap();
        assert_eq!(parsed.name, "prod");
        assert_eq!(parsed.environment, Environment::Prod);
        assert!(parsed.read_only);
    }

    #[test]
    fn roundtrip_bundle() {
        let conns = vec![fake_conn("a"), fake_conn("b")];
        let payload = to_bundle_payload("team", &conns).unwrap();
        let parsed = from_bundle_payload(&payload).unwrap();
        assert_eq!(parsed.name, "team");
        assert_eq!(parsed.connections.len(), 2);
    }

    #[test]
    fn summary_is_human_readable() {
        let c = fake_conn("prod");
        let payload = to_single_payload(&c).unwrap();
        let summary_text = summary(&payload).unwrap();
        assert_eq!(summary_text, "prod (db.example.com:5432 / myapp)");
    }

    #[test]
    fn bundle_summary_format() {
        let conns = vec![fake_conn("a"), fake_conn("b"), fake_conn("c")];
        let payload = to_bundle_payload("team-mirror", &conns).unwrap();
        assert_eq!(            bundle_summary(&payload).unwrap(),
            "team-mirror (3 connections)"
);
    }
}
