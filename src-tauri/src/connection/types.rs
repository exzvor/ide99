//! Tauri IPC DTOs + error type. Schemas serialize to JSON via serde.
//!
//! Note: the connection structs carry > 3 bool fields each
//! (`exclude_from_history`, `read_only`, `slow_query_warning`,
//! `confirm_destructive`); allow the corresponding pedantic clippy
//! lint at file scope rather than ceremonially boxing them.

#![allow(clippy::struct_excessive_bools, clippy::fn_params_excessive_bools)]

use std::fmt;

use serde::{Deserialize, Serialize};

const fn default_true() -> bool {
    true
}

/// Per-connection environment tag . Drives default safety guards
/// and visual indicators (header strip, list dot, result-grid header tint).
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    #[default]
    Local,
    Dev,
    Stage,
    Prod,
}

impl Environment {
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Dev => "dev",
            Self::Stage => "stage",
            Self::Prod => "prod",
        }
    }

    /// Lossy parse — unknown / corrupt `SQLite` values fall back to `Local`
    /// (safe default, matches migration 005 column DEFAULT).
    #[must_use]
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "dev" => Self::Dev,
            "stage" => Self::Stage,
            "prod" => Self::Prod,
            _ => Self::Local,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub ssl_mode: SslMode,
    pub has_password: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_tested_at: Option<String>,
    pub last_test_ok: Option<bool>,
    pub exclude_from_history: bool,
    #[serde(default)]
    pub exclude_from_recent_plans: bool,
    #[serde(default)]
    pub environment: Environment,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub slow_query_warning: bool,
    #[serde(default)]
    pub confirm_destructive: bool,
    #[serde(default)]
    pub migrations_dir: Option<String>,
    #[serde(default = "default_true")]
    pub migration_tracking_enabled: bool,
    #[serde(default)]
    pub migration_snapshots_enabled: bool,
    #[serde(default = "default_true")]
    pub squawk_lint_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: Option<String>,
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub exclude_from_history: bool,
    #[serde(default)]
    pub exclude_from_recent_plans: bool,
    #[serde(default)]
    pub environment: Environment,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub slow_query_warning: bool,
    #[serde(default)]
    pub confirm_destructive: bool,
    #[serde(default)]
    pub migrations_dir: Option<String>,
    #[serde(default = "default_true")]
    pub migration_tracking_enabled: bool,
    #[serde(default)]
    pub migration_snapshots_enabled: bool,
    #[serde(default = "default_true")]
    pub squawk_lint_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: UpdatePassword,
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub exclude_from_history: bool,
    #[serde(default)]
    pub exclude_from_recent_plans: bool,
    #[serde(default)]
    pub environment: Environment,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub slow_query_warning: bool,
    #[serde(default)]
    pub confirm_destructive: bool,
    #[serde(default)]
    pub migrations_dir: Option<String>,
    #[serde(default = "default_true")]
    pub migration_tracking_enabled: bool,
    #[serde(default)]
    pub migration_snapshots_enabled: bool,
    #[serde(default = "default_true")]
    pub squawk_lint_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdatePassword {
    Keep,
    Set { value: String },
    Clear,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestInput {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: Option<String>,
    pub ssl_mode: SslMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedUri {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: Option<String>,
    pub ssl_mode: SslMode,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SslMode {
    Disable,
    Allow,
    #[default]
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

impl SslMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disable => "disable",
            Self::Allow => "allow",
            Self::Prefer => "prefer",
            Self::Require => "require",
            Self::VerifyCa => "verify-ca",
            Self::VerifyFull => "verify-full",
        }
    }

    /// Lenient parse: unknown / empty values fall back to `Prefer` per spec §6.5
    /// (matches `PostgreSQL`'s own default).
    #[must_use]
    pub fn parse_lenient(s: &str) -> Self {
        Self::from_token(s).unwrap_or(Self::Prefer)
    }

    #[must_use]
    pub fn from_token(s: &str) -> Option<Self> {
        match s {
            "disable" => Some(Self::Disable),
            "allow" => Some(Self::Allow),
            "prefer" => Some(Self::Prefer),
            "require" => Some(Self::Require),
            "verify-ca" => Some(Self::VerifyCa),
            "verify-full" => Some(Self::VerifyFull),
            _ => None,
        }
    }
}

impl fmt::Display for SslMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum ConnectionError {
    #[error("connection not found: {0}")]
    NotFound(String),
    #[error("connection name already in use: {0}")]
    DuplicateName(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("invalid URI: {0}")]
    InvalidUri(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("keychain error: {0}")]
    Keychain(String),
    /// Connect probe failed because PostgreSQL demanded a password we don't
    /// have stored — the previous wrapping in `Keychain` produced misleading
    /// UI copy ("no access to keychain") for what is actually "user never
    /// entered a password". Carries the connection name so the frontend can
    /// surface a proper "Open Edit" recovery affordance.
    #[error("no saved password for connection: {0}")]
    PasswordMissing(String),
    #[error("postgres error: {0}")]
    Postgres(String),
    #[error("connection not active: {0}")]
    NotConnected(String),
    #[error("io error: {0}")]
    Io(String),
}
