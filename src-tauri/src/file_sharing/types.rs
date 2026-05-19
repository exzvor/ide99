//! `.ide99` file format DTOs + error type.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ShareKind {
    Connection,
    ConnectionBundle,
    Snippet,
    SnippetBundle,
    Query,
    Notebook,
    MigrationSet,
    ErdLayout,
    Theme,
    Keymap,
    HealthConfig,
}

impl ShareKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Connection => "connection",
            Self::ConnectionBundle => "connection-bundle",
            Self::Snippet => "snippet",
            Self::SnippetBundle => "snippet-bundle",
            Self::Query => "query",
            Self::Notebook => "notebook",
            Self::MigrationSet => "migration-set",
            Self::ErdLayout => "erd-layout",
            Self::Theme => "theme",
            Self::Keymap => "keymap",
            Self::HealthConfig => "health-config",
        }
    }
}

/// Universal `.ide99` envelope. `payload` is per-kind opaque JSON; routed by
/// `kind` to the right serializer in `kinds::*`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareEnvelope {
    pub version: u32,
    pub kind: ShareKind,
    pub exported_at: String,
    pub payload: serde_json::Value,
}

pub const SHARE_FORMAT_VERSION: u32 = 1;

/// Frontend preview after a `.ide99` import — shown in the merge / replace
/// modal before any database writes happen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub kind: ShareKind,
    pub version: u32,
    pub exported_at: String,
    /// Human-readable one-line summary ("Connection «prod-mirror» (host:port/db)").
    pub summary: String,
    /// True iff this kind requires a destructive merge (connection rename
    /// collisions, snippet name collisions, etc.).
    pub may_collide: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ShareError {
    #[error("invalid file: {0}")]
    InvalidFile(String),
    #[error("unsupported version: got {got}, max {max}")]
    UnsupportedVersion { got: u32, max: u32 },
    #[error("kind not yet supported (Phase F): {0}")]
    NotImplemented(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("io error: {0}")]
    Io(String),
}

impl serde::Serialize for ShareError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, message) = match self {
            Self::InvalidFile(m) => ("invalid_file", m.clone()),
            Self::UnsupportedVersion { got, max } => (
                "unsupported_version",
                format!("got version {got}, max supported {max}"),
            ),
            Self::NotImplemented(m) => ("not_implemented", m.clone()),
            Self::Storage(m) => ("storage_error", m.clone()),
            Self::Io(m) => ("io_error", m.clone()),
        };
        let mut s = ser.serialize_struct("ShareError", 2)?;
        s.serialize_field("code", code)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}
