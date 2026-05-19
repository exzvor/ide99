//! `pg_basebackup` command builder. Supports `--incremental` (PG 17+).
//!
//! Pure builder + validator; subprocess plumbing is delegated to
//! `commands.rs` (mirrors what `dump.rs` / `restore.rs` do).

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use crate::backup::types::{BaseBackupCompression, BaseBackupOptions};
use crate::connection::types::Connection;

#[must_use]
pub fn build_args(conn: &Connection, opts: &BaseBackupOptions) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    args.push("-h".into());
    args.push(conn.host.clone());
    args.push("-p".into());
    args.push(conn.port.to_string());
    args.push("-U".into());
    args.push(conn.username.clone());

    args.push("-D".into());
    args.push(opts.output_dir.clone());

    args.push("--format=tar".into());
    args.push("--wal-method=stream".into());
    args.push("--progress".into());
    args.push("--verbose".into());

    match opts.compression {
        BaseBackupCompression::None => {}
        BaseBackupCompression::Gzip => {
            args.push("--compress=gzip".into());
        }
        BaseBackupCompression::Lz4 => {
            args.push("--compress=lz4".into());
        }
        BaseBackupCompression::Zstd => {
            args.push("--compress=zstd".into());
        }
    }

    if let Some(manifest) = &opts.incremental_from_manifest {
        args.push(format!("--incremental={manifest}"));
    }

    args
}

pub fn validate(opts: &BaseBackupOptions) -> Result<(), String> {
    if opts.output_dir.trim().is_empty() {
        return Err("outputDir must not be empty".into());
    }
    if let Some(manifest) = &opts.incremental_from_manifest {
        if manifest.trim().is_empty() {
            return Err("incrementalFromManifest must not be empty when set".into());
        }
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

    fn opts() -> BaseBackupOptions {
        BaseBackupOptions {
            connection_id: "c1".into(),
            output_dir: "/var/backups/pg".into(),
            incremental_from_manifest: None,
            compression: BaseBackupCompression::None,
        }
    }

    #[test]
    fn full_backup_omits_incremental() {
        let args = build_args(&fake_conn(), &opts());
        assert!(args.contains(&"--format=tar".into()));
        assert!(args.contains(&"--wal-method=stream".into()));
        assert!(!args.iter().any(|a| a.starts_with("--incremental")));
    }

    #[test]
    fn incremental_emits_flag() {
        let mut o = opts();
        o.incremental_from_manifest = Some("/var/backups/pg/full/backup_manifest".into());
        let args = build_args(&fake_conn(), &o);
        assert!(args
            .iter()
            .any(|a| a == "--incremental=/var/backups/pg/full/backup_manifest"));
    }

    #[test]
    fn compression_gzip() {
        let mut o = opts();
        o.compression = BaseBackupCompression::Gzip;
        let args = build_args(&fake_conn(), &o);
        assert!(args.contains(&"--compress=gzip".into()));
    }

    #[test]
    fn validate_rejects_empty_output_dir() {
        let mut o = opts();
        o.output_dir = "".into();
        assert!(validate(&o).is_err());
    }
}
