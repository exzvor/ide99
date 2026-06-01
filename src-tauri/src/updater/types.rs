//! Updater DTOs.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseChannel {
    Stable,
    Beta,
    Nightly,
}

impl ReleaseChannel {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Nightly => "nightly",
        }
    }

    #[must_use]
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "beta" => Self::Beta,
            "nightly" => Self::Nightly,
            _ => Self::Stable,
        }
    }
}

/// Mirror of the `updates.ide99.io/<channel>/manifest.json` shape.
/// Tauri plugin uses this exact schema (see plugin docs).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    /// Per-platform { signature, url }. Branching follows the Tauri docs;
    /// v1.0 only carries the schema.
    pub platforms: std::collections::BTreeMap<String, PlatformAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAsset {
    pub signature: String,
    pub url: String,
}

/// Result returned by `updater_check`. `Available` carries the manifest;
/// `UpToDate` is what UI renders as a green "you're current" banner.
///
/// `rename_all_fields = "camelCase"` ensures the per-variant struct fields
/// arrive on the wire as `currentVersion`, `checkedAt` etc. (matching the
/// frontend `CheckResult` union); `rename_all = "camelCase"` keeps the
/// `kind` discriminator values lowerCamel (`upToDate` etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CheckResult {
    UpToDate {
        current_version: String,
        channel: ReleaseChannel,
        checked_at: String,
    },
    Available {
        current_version: String,
        manifest: UpdateManifest,
        channel: ReleaseChannel,
        checked_at: String,
    },
    Error {
        /// Stable, UI-facing failure code so the renderer can show a calm,
        /// localized message instead of a raw resolver/transport string.
        /// `"unavailable"` — the updater could not be built (no endpoints /
        /// not configured). `"unreachable"` — the update server could not be
        /// reached or returned no usable manifest. The free-form `message`
        /// is kept for logs/diagnostics, not for direct display.
        code: String,
        message: String,
        channel: ReleaseChannel,
        checked_at: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum UpdaterError {
    #[error("storage error: {0}")]
    Storage(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("install failed: {0}")]
    Install(String),
}

impl serde::Serialize for UpdaterError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, message) = match self {
            Self::Storage(m) => ("storage_error", m.clone()),
            Self::Network(m) => ("network_error", m.clone()),
            Self::InvalidManifest(m) => ("invalid_manifest", m.clone()),
            Self::Install(m) => ("install_failed", m.clone()),
        };
        let mut s = ser.serialize_struct("UpdaterError", 2)?;
        s.serialize_field("code", code)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}
