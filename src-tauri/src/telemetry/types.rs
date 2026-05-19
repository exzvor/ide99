//! Telemetry DTOs + error type.

#![allow(clippy::struct_excessive_bools)]

use serde::{Deserialize, Serialize};

/// Endpoint region. RU users default to `telemetry.ide99.ru` (Yandex Cloud),
/// everyone else to `telemetry.ide99.io` (EU). User can override in Settings.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TelemetryEndpoint {
    #[default]
    Eu,
    Ru,
    /// `none` is a defence-in-depth — even if `telemetry_enabled = 1` flips
    /// on accidentally, `endpoint = none` blocks the actual HTTP call.
    None,
}

impl TelemetryEndpoint {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Eu => "eu",
            Self::Ru => "ru",
            Self::None => "none",
        }
    }

    #[must_use]
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "ru" => Self::Ru,
            "none" => Self::None,
            _ => Self::Eu,
        }
    }

    /// Resolve the actual base URL for `client::send_event`. `None` means
    /// "do not send" — caller must short-circuit before composing the request.
    #[must_use]
    pub const fn base_url(self) -> Option<&'static str> {
        match self {
            Self::Eu => Some("https://telemetry.ide99.io"),
            Self::Ru => Some("https://telemetry.ide99.ru"),
            Self::None => None,
        }
    }
}

/// Snapshot returned to frontend on each load and each `set_*` call.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub telemetry_enabled: bool,
    pub crash_reports_enabled: bool,
    pub telemetry_endpoint: TelemetryEndpoint,
    pub device_uuid: Option<String>,
    pub onboarding_completed: bool,
    pub privacy_choice_made: bool,
    pub privacy_choice_made_at: Option<String>,
    /// — `stable | beta | nightly`. Drives the auto-updater
    /// manifest URL.
    #[serde(default = "default_release_channel")]
    pub release_channel: String,
    #[serde(default)]
    pub last_update_check_at: Option<String>,
    /// — paid-module subscription flags. Default OFF;
    /// `modules::manager::sign_in_*` flips them when the user authenticates.
    #[serde(default)]
    pub spg99_subscribed: bool,
    #[serde(default)]
    pub vibepg_subscribed: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn default_release_channel() -> String {
    "stable".to_string()
}

/// One telemetry event. `props` are scalar key→value strings (counts encoded
/// as decimal), so the wire shape stays under PostHog's `properties` limit
/// without a mutable JSON blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEvent {
    /// Snake-case event name (e.g. `feature_used`, `query_executed`,
    /// `tab_opened`). Allowlisted by `events::is_known_event`.
    pub name: String,
    /// Anonymous device UUID — same per install, no link to PII.
    pub distinct_id: String,
    /// `props` MUST NOT contain query text, schema names, or any PII.
    /// `events::sanitize_props` strips dangerous keys before send.
    pub props: std::collections::BTreeMap<String, String>,
}

/// Crash report payload — built only when the user opts in AND previews
/// the report in the dialog before send.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub message: String,
    /// Stack trace text (may include filenames; no env / argv).
    pub stack: String,
    /// Compact OS / version metadata. Build is `app_version`.
    pub platform: String,
    pub app_version: String,
    pub captured_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    #[error("storage error: {0}")]
    Storage(String),
    #[error("not opted in")]
    NotOptedIn,
    #[error("unknown event: {0}")]
    UnknownEvent(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("network error: {0}")]
    Network(String),
}

impl serde::Serialize for TelemetryError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, message) = match self {
            Self::Storage(m) => ("storage_error", m.clone()),
            Self::NotOptedIn => ("not_opted_in", "user has not opted in".into()),
            Self::UnknownEvent(name) => ("unknown_event", format!("unknown event: {name}")),
            Self::InvalidInput(m) => ("invalid_input", m.clone()),
            Self::Network(m) => ("network_error", m.clone()),
        };
        let mut s = ser.serialize_struct("TelemetryError", 2)?;
        s.serialize_field("code", code)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}
