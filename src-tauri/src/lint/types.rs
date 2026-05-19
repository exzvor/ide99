//! DTOs shared across lint submodules + serialized to the frontend.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SquawkSeverity {
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SquawkFinding {
    pub rule: String,
    pub severity: SquawkSeverity,
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInstallResult {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRulesResult {
    pub rules: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintFileResult {
    pub findings: Vec<SquawkFinding>,
}

#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum LintError {
    #[error("Squawk binary not on PATH")]
    NotInstalled,
    #[error("Squawk subprocess timed out after {ms}ms")]
    Timeout { ms: u64 },
    #[error("Squawk returned unparseable JSON: {0}")]
    ParseError(String),
    #[error("Squawk subprocess exited {code}: {stderr}")]
    SubprocessFailed { code: i32, stderr: String },
    #[error("io: {0}")]
    Io(String),
}
