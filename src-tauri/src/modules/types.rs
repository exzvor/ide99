//! Paid-module DTOs.

use serde::{Deserialize, Serialize};

/// Module identity. New modules in v1.1+ extend this enum.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModuleId {
    Spg99,
    Vibepg,
}

impl ModuleId {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Spg99 => "spg99",
            Self::Vibepg => "vibepg",
        }
    }
}

/// Subscription state snapshot the UI uses to decide visibility.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionState {
    pub spg99_subscribed: bool,
    pub vibepg_subscribed: bool,
    /// Upgrade pages — exposed so frontend doesn't hard-code URLs.
    pub upgrade_url_spg99: String,
    pub upgrade_url_vibepg: String,
}

impl Default for SubscriptionState {
    fn default() -> Self {
        Self {
            spg99_subscribed: false,
            vibepg_subscribed: false,
            upgrade_url_spg99: "https://spg99.ru/instant-db".to_string(),
            upgrade_url_vibepg: "https://vibepg.ai/upgrade".to_string(),
        }
    }
}

/// Pre-flight result for "Reproduce on disposable DB" / "vibepg review" /
/// any other action that requires an active subscription. Returned by the
/// `module_action_pre_flight` IPC so the frontend renders the upgrade
/// banner with consistent copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPreflight {
    pub module: ModuleId,
    pub allowed: bool,
    /// When `allowed = false`, the URL frontend opens via `tauri::shell::open`.
    pub upgrade_url: Option<String>,
    /// One-line user-facing reason. i18n key in normal flow, raw English
    /// fallback if i18n bundle missing.
    pub reason_key: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ModuleError {
    #[error("not subscribed: {0:?}")]
    NotSubscribed(ModuleId),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

impl serde::Serialize for ModuleError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, message) = match self {
            Self::NotSubscribed(id) => (                "not_subscribed",
                format!("module {} requires an active subscription", id.as_str()),
),
            Self::Storage(m) => ("storage_error", m.clone()),
            Self::InvalidInput(m) => ("invalid_input", m.clone()),
        };
        let mut s = ser.serialize_struct("ModuleError", 2)?;
        s.serialize_field("code", code)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}
