//! Backup & Restore wrapper.
//!
//! Thin wrapper around `pg_dump`, `pg_restore`, `pg_basebackup`
//! (including incremental on PG 17+). The module is designed as
//! **exec-only**: no in-house serialization of the pg_dump format — we
//! invoke the CLI utility and parse its stderr (`--verbose`) for
//! progress.
//!
//! Security: the password never goes on the command line; it is passed
//! through the subprocess `PGPASSWORD` env var and removed from the
//! parent environment after spawn. See `dump::build_command` for
//! details.
//!
//! Schedule (no server components): we create a cron entry (Linux/macOS)
//! or a Scheduled Task XML (Windows). ide99 does not need to be
//! running — pg_dump is launched directly by the system scheduler.

pub mod basebackup;
pub mod commands;
pub mod dump;
pub mod installer;
pub mod progress;
pub mod restore;
pub mod runner;
pub mod schedule;
pub mod types;
