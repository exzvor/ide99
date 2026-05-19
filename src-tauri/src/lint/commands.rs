//! Tauri command handlers for the Squawk lint integration.
//!
//! Three commands wired through to the discovery / rules / runner modules:
//! `lint_check_install`, `lint_list_rules`, `lint_file`.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]
#![allow(clippy::needless_pass_by_value, clippy::unused_async)]

use crate::lint::types::{CheckInstallResult, LintError, LintFileResult, ListRulesResult};
use crate::lint::{discovery, rules, runner};

#[tauri::command]
pub async fn lint_check_install() -> Result<CheckInstallResult, LintError> {
    Ok(discovery::find_squawk().await)
}

#[tauri::command]
pub async fn lint_list_rules() -> Result<ListRulesResult, LintError> {
    rules::list_rules().await
}

#[tauri::command]
pub async fn lint_file(path: String) -> Result<LintFileResult, LintError> {
    runner::lint_path(&path).await
}
