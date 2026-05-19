//! `pg_dump` command builder + spawn helper.
//!
//! `build_args` is pure (returns `Vec<String>`) and unit-tested. The
//! spawn side (`run`) uses the tokio process API plus a stderr line
//! stream feeding the progress parser. Password is passed through the
//! child's `PGPASSWORD` env var (never argv) — standard practice
//! supported by all pg-tools.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use crate::backup::types::{BackupOptions, DumpFormat, DumpScope};
use crate::connection::types::Connection;

/// Build `pg_dump` argv (without binary path and without password —
/// those live outside).
/// Order: connection flags (-h/-p/-U/-d) → format → scope → filters →
/// performance → output path.
#[must_use]
pub fn build_args(conn: &Connection, opts: &BackupOptions) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    args.push("-h".into());
    args.push(conn.host.clone());
    args.push("-p".into());
    args.push(conn.port.to_string());
    args.push("-U".into());
    args.push(conn.username.clone());
    args.push("-d".into());
    args.push(conn.database.clone());

    args.push(opts.format.as_flag().into());

    match opts.scope {
        DumpScope::DataOnly => args.push("--data-only".into()),
        DumpScope::SchemaOnly => args.push("--schema-only".into()),
        DumpScope::Both => {}
    }

    for schema in &opts.include_schemas {
        args.push("-n".into());
        args.push(schema.clone());
    }
    for table in &opts.include_tables {
        args.push("-t".into());
        args.push(table.clone());
    }
    for table in &opts.exclude_table_data {
        args.push("--exclude-table-data".into());
        args.push(table.clone());
    }

    if opts.format == DumpFormat::Custom {
        args.push("-Z".into());
        args.push(opts.compress_level.to_string());
    }

    if opts.format == DumpFormat::Directory {
        if let Some(jobs) = opts.parallel_jobs {
            args.push("--jobs".into());
            args.push(jobs.to_string());
        }
    }

    if opts.include_create_db {
        args.push("--create".into());
    }
    if opts.no_owner {
        args.push("--no-owner".into());
    }

    args.push("--verbose".into());
    args.push("-f".into());
    args.push(opts.output_path.clone());

    args
}

/// Validate options; returns Err with human-readable message if invalid.
/// Frontend wizard already restricts most fields, but defence-in-depth here
/// catches programmatic / tampered IPC payloads.
pub fn validate(opts: &BackupOptions) -> Result<(), String> {
    if opts.compress_level > 9 {
        return Err("compressLevel must be 0..=9".into());
    }
    if let Some(jobs) = opts.parallel_jobs {
        if jobs == 0 {
            return Err("parallelJobs must be >= 1".into());
        }
        if opts.format != DumpFormat::Directory {
            return Err("parallelJobs requires format='directory'".into());
        }
    }
    if opts.output_path.trim().is_empty() {
        return Err("outputPath must not be empty".into());
    }
    Ok(())
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
            database: "myapp".into(),
            username: "alice".into(),
            ssl_mode: SslMode::Prefer,
            has_password: true,
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

    fn opts() -> BackupOptions {
        BackupOptions {
            connection_id: "c1".into(),
            format: DumpFormat::Custom,
            scope: DumpScope::Both,
            include_schemas: vec![],
            include_tables: vec![],
            exclude_table_data: vec![],
            compress_level: 5,
            parallel_jobs: None,
            output_path: "/tmp/dump.bin".into(),
            include_create_db: false,
            no_owner: false,
        }
    }

    #[test]
    fn basic_args_have_connection_and_output() {
        let args = build_args(&fake_conn(), &opts());
        assert!(args.contains(&"-h".into()));
        assert!(args.contains(&"localhost".into()));
        assert!(args.contains(&"-d".into()));
        assert!(args.contains(&"myapp".into()));
        assert!(args.contains(&"-Fc".into()));
        assert!(args.contains(&"-f".into()));
        assert!(args.contains(&"/tmp/dump.bin".into()));
        assert!(args.contains(&"--verbose".into()));
    }

    #[test]
    fn data_only_emits_flag() {
        let mut o = opts();
        o.scope = DumpScope::DataOnly;
        let args = build_args(&fake_conn(), &o);
        assert!(args.contains(&"--data-only".into()));
        assert!(!args.contains(&"--schema-only".into()));
    }

    #[test]
    fn schema_filter_repeats_dash_n() {
        let mut o = opts();
        o.include_schemas = vec!["public".into(), "audit".into()];
        let args = build_args(&fake_conn(), &o);
        let n_count = args.iter().filter(|a| *a == "-n").count();
        assert_eq!(n_count, 2);
    }

    #[test]
    fn parallel_jobs_only_with_directory() {
        let mut o = opts();
        o.parallel_jobs = Some(4);
        // Custom format → validate rejects.
        assert!(validate(&o).is_err());
        o.format = DumpFormat::Directory;
        assert!(validate(&o).is_ok());
        let args = build_args(&fake_conn(), &o);
        assert!(args.contains(&"--jobs".into()));
        assert!(args.contains(&"4".into()));
    }

    #[test]
    fn validate_rejects_bad_compress() {
        let mut o = opts();
        o.compress_level = 12;
        assert!(validate(&o).is_err());
    }

    #[test]
    fn validate_rejects_empty_output() {
        let mut o = opts();
        o.output_path = "  ".into();
        assert!(validate(&o).is_err());
    }
}
