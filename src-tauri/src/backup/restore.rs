//! `pg_restore` command builder + spawn helper.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use crate::backup::types::RestoreOptions;
use crate::connection::types::Connection;

#[must_use]
pub fn build_args(conn: &Connection, opts: &RestoreOptions) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    args.push("-h".into());
    args.push(conn.host.clone());
    args.push("-p".into());
    args.push(conn.port.to_string());
    args.push("-U".into());
    args.push(conn.username.clone());
    args.push("-d".into());
    args.push(conn.database.clone());

    if opts.clean_before_restore {
        args.push("--clean".into());
    }
    if opts.create_database {
        args.push("--create".into());
    }
    if opts.no_owner {
        args.push("--no-owner".into());
    }
    if let Some(jobs) = opts.parallel_jobs {
        args.push("--jobs".into());
        args.push(jobs.to_string());
    }

    args.push("--verbose".into());
    args.push(opts.source_path.clone());

    args
}

pub fn validate(opts: &RestoreOptions) -> Result<(), String> {
    if opts.source_path.trim().is_empty() {
        return Err("sourcePath must not be empty".into());
    }
    if let Some(jobs) = opts.parallel_jobs {
        if jobs == 0 {
            return Err("parallelJobs must be >= 1".into());
        }
    }
    Ok(())
}

/// Build a `pg_restore -L` list-file body. Each requested object is one
/// line; pg_restore treats `;`-prefixed lines as comments (deselect).
/// Returns raw text that the caller writes to a temp file and passes
/// via the `-L` flag.
#[must_use]
pub fn build_list_file(selected: &[String]) -> String {
    selected
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::types::{Environment, SslMode};

    fn fake_conn() -> Connection {
        Connection {
            id: "c1".into(),
            name: "demo".into(),
            host: "localhost".into(),
            port: 5432,
            database: "target".into(),
            username: "bob".into(),
            ssl_mode: SslMode::Prefer,
            has_password: false,
            created_at: "2026-05-06T00:00:00Z".into(),
            updated_at: "2026-05-06T00:00:00Z".into(),
            last_tested_at: None,
            last_test_ok: None,
            exclude_from_history: false,
            exclude_from_recent_plans: false,
            environment: Environment::Local,
            read_only: false,
            slow_query_warning: false,
            confirm_destructive: false,
            migrations_dir: None,
            migration_tracking_enabled: true,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: true,
        }
    }

    fn opts() -> RestoreOptions {
        RestoreOptions {
            connection_id: "c1".into(),
            source_path: "/tmp/dump.bin".into(),
            clean_before_restore: false,
            create_database: false,
            no_owner: false,
            parallel_jobs: None,
            selected_objects: vec![],
        }
    }

    #[test]
    fn args_include_source_path_last() {
        let args = build_args(&fake_conn(), &opts());
        assert_eq!(args.last().unwrap(), "/tmp/dump.bin");
    }

    #[test]
    fn clean_emits_flag() {
        let mut o = opts();
        o.clean_before_restore = true;
        let args = build_args(&fake_conn(), &o);
        assert!(args.contains(&"--clean".into()));
    }

    #[test]
    fn list_file_strips_blanks() {
        let lines = build_list_file(&["TABLE users".into(), "  ".into(), "TABLE orders".into()]);
        assert_eq!(lines, "TABLE users\nTABLE orders");
    }

    #[test]
    fn validate_rejects_empty_source() {
        let mut o = opts();
        o.source_path = "".into();
        assert!(validate(&o).is_err());
    }
}
