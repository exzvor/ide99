//! — Filesystem discovery for migration files.
//!
//! Parses `{NNN}_{name}.up.sql` / `.down.sql` filenames in a directory, pairs
//! `.up`/`.down` files by version, and surfaces structural problems (duplicate
//! versions, orphan rollback files) as `parse_error` on individual `Migration`
//! entries rather than aborting the whole scan.
//!
//! Also exposes the SHA-256 helper used by the executor and the
//! `-- ide99:no-transaction` magic-comment parser.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::items_after_statements,
    clippy::too_many_lines
)]

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::migrations::types::{Migration, MigrationStatus, MigrationsError};

/// Internal pairing structure: per-version `up`/`down` paths and the set of
/// distinct names seen for that version. >1 distinct name = duplicate.
struct Pair {
    up_path: Option<String>,
    down_path: Option<String>,
    names: Vec<String>,
}

/// Filename grammar: `^([0-9]{4,})_([a-z0-9_]+)\.(up|down)\.sql$`.
fn filename_regex() -> Regex {
    // 4+ digits (zero-padded sortable), underscore, snake-case name, .up|.down .sql.
    Regex::new(r"^([0-9]{4,})_([a-z0-9_]+)\.(up|down)\.sql$").expect("static regex compiles")
}

/// Scan `dir` for migration files.
///
/// Returns a sorted `Vec<Migration>`. Errors only on directory-level IO
/// failures (missing dir, permission denied); per-file parse problems become
/// `parse_error` on a `Migration` entry.
///
/// Discovery yields `MigrationStatus::Pending` for everything; ledger
/// reconciliation happens later in `tracking::join_with_ledger`.
pub fn discover(dir: &Path) -> Result<Vec<Migration>, MigrationsError> {
    let entries = fs::read_dir(dir).map_err(|e| MigrationsError::Io(format!("{e}")))?;

    let re = filename_regex();

    let mut by_version: BTreeMap<String, Pair> = BTreeMap::new();

    for entry in entries {
        let entry = entry.map_err(|e| MigrationsError::Io(format!("{e}")))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        let Some(caps) = re.captures(file_name) else {
            // Not a migration file — silently ignore (README.md, .gitignore, foo.sql, etc.).
            continue;
        };

        let version = caps.get(1).expect("group 1").as_str().to_string();
        let name = caps.get(2).expect("group 2").as_str().to_string();
        let kind = caps.get(3).expect("group 3").as_str();

        let path_str = path.to_string_lossy().to_string();

        let slot = by_version.entry(version).or_insert(Pair {
            up_path: None,
            down_path: None,
            names: Vec::new(),
        });
        if !slot.names.contains(&name) {
            slot.names.push(name.clone());
        }
        match kind {
            "up" => slot.up_path = Some(path_str),
            "down" => slot.down_path = Some(path_str),
            _ => unreachable!("regex group 3 is up|down"),
        }
    }

    let mut out: Vec<Migration> = Vec::with_capacity(by_version.len());

    for (version, pair) in by_version {
        let duplicate = pair.names.len() > 1;
        // Pick a primary name: prefer the up file's name if present, else first.
        // For duplicate version we still emit one entry with parse_error; the
        // ordering for the displayed name is the first encountered, which is
        // deterministic since we sorted the BTreeMap insertion + vec append.
        let name = pair.names.first().cloned().unwrap_or_default();

        if duplicate {
            // Per-spec failure mode: both files flagged "duplicate version".
            // We surface a single Migration entry per version with parse_error
            // set; `up_path` is set if any up exists so the panel still has
            // a path to show. Apply button will be disabled by the FE.
            let up_path = pair.up_path.unwrap_or_default();
            let disk_checksum = if up_path.is_empty() {
                String::new()
            } else {
                match fs::read(&up_path) {
                    Ok(bytes) => checksum_hex(&bytes),
                    Err(_) => String::new(),
                }
            };
            out.push(Migration {
                version,
                name,
                up_path,
                down_path: pair.down_path,
                status: MigrationStatus::Pending,
                applied_at: None,
                applied_by: None,
                duration_ms: None,
                disk_checksum,
                applied_checksum: None,
                has_snapshot: false,
                parse_error: Some("duplicate version".into()),
            });
            continue;
        }

        match (pair.up_path, pair.down_path) {
            (Some(up_path), down_path) => {
                let disk_checksum = match fs::read(&up_path) {
                    Ok(bytes) => checksum_hex(&bytes),
                    Err(e) => return Err(MigrationsError::Io(format!("{e}"))),
                };
                out.push(Migration {
                    version,
                    name,
                    up_path,
                    down_path,
                    status: MigrationStatus::Pending,
                    applied_at: None,
                    applied_by: None,
                    duration_ms: None,
                    disk_checksum,
                    applied_checksum: None,
                    has_snapshot: false,
                    parse_error: None,
                });
            }
            (None, Some(down_path)) => {
                // Orphan rollback — surface with parse_error. up_path is empty
                // (no real file); FE will disable apply.
                out.push(Migration {
                    version,
                    name,
                    up_path: String::new(),
                    down_path: Some(down_path),
                    status: MigrationStatus::Pending,
                    applied_at: None,
                    applied_by: None,
                    duration_ms: None,
                    disk_checksum: String::new(),
                    applied_checksum: None,
                    has_snapshot: false,
                    parse_error: Some("orphan rollback file".into()),
                });
            }
            (None, None) => {
                // Should never happen — slot only created when a regex match occurred.
            }
        }
    }

    // BTreeMap iteration is sorted by key (version) lexicographically — exactly
    // what we want for `0001`, `0002`, …, `9999`, `10000`.
    Ok(out)
}

/// SHA-256 hex of `bytes`. Lowercase, no separators.
#[must_use]
pub fn checksum_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

/// Returns true iff the first non-blank line of `sql`, after trimming ASCII
/// whitespace, equals exactly `-- ide99:no-transaction`.
///
/// "Blank line" = empty after trimming. Match is byte-exact, ASCII-only.
#[must_use]
pub fn has_no_transaction_directive(sql: &str) -> bool {
    for line in sql.lines() {
        let trimmed = line.trim_matches(|c: char| c.is_ascii_whitespace());
        if trimmed.is_empty() {
            continue;
        }
        return trimmed == "-- ide99:no-transaction";
    }
    false
}

/// True iff `versions` is a contiguous slice of `pending` (in order, no gaps).
/// `from` and `to` must both exist in `pending`. Range is inclusive on both
/// ends.
#[must_use]
pub fn is_contiguous_range(pending: &[String], from: &str, to: &str) -> bool {
    let from_idx = pending.iter().position(|v| v == from);
    let to_idx = pending.iter().position(|v| v == to);
    matches!((from_idx, to_idx), (Some(f), Some(t)) if f <= t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write(dir: &TempDir, name: &str, body: &str) {
        fs::write(dir.path().join(name), body).unwrap();
    }

    #[test]
    fn parses_basic_pair() {
        let dir = TempDir::new().unwrap();
        write(&dir, "0001_create_users.up.sql", "CREATE TABLE u();");
        write(&dir, "0001_create_users.down.sql", "DROP TABLE u;");

        let out = discover(dir.path()).unwrap();
        assert_eq!(out.len(), 1);
        let m = &out[0];
        assert_eq!(m.version, "0001");
        assert_eq!(m.name, "create_users");
        assert!(m.up_path.ends_with("0001_create_users.up.sql"));
        assert!(m
            .down_path
            .as_deref()
            .unwrap()
            .ends_with("0001_create_users.down.sql"));
        assert_eq!(m.status, MigrationStatus::Pending);
        assert!(m.parse_error.is_none());
        assert_eq!(m.disk_checksum.len(), 64);
    }

    #[test]
    fn up_only_no_rollback() {
        let dir = TempDir::new().unwrap();
        write(
            &dir,
            "0002_add_email.up.sql",
            "ALTER TABLE u ADD email text;",
        );

        let out = discover(dir.path()).unwrap();
        assert_eq!(out.len(), 1);
        let m = &out[0];
        assert!(m.down_path.is_none());
        assert!(m.parse_error.is_none());
    }

    #[test]
    fn orphan_down_file() {
        let dir = TempDir::new().unwrap();
        write(&dir, "0003_lonely.down.sql", "DROP TABLE x;");

        let out = discover(dir.path()).unwrap();
        assert_eq!(out.len(), 1);
        let m = &out[0];
        assert_eq!(m.parse_error.as_deref(), Some("orphan rollback file"));
        assert!(m.down_path.is_some());
        assert!(m.up_path.is_empty());
    }

    #[test]
    fn duplicate_version() {
        let dir = TempDir::new().unwrap();
        write(&dir, "0001_a.up.sql", "SELECT 1;");
        write(&dir, "0001_b.up.sql", "SELECT 2;");

        let out = discover(dir.path()).unwrap();
        assert_eq!(out.len(), 1);
        let m = &out[0];
        assert_eq!(m.parse_error.as_deref(), Some("duplicate version"));
        assert_eq!(m.version, "0001");
    }

    #[test]
    fn ignores_non_migration_files() {
        let dir = TempDir::new().unwrap();
        write(&dir, "README.md", "hi");
        write(&dir, ".gitignore", "*.log");
        write(&dir, "foo.sql", "SELECT 1;");
        write(&dir, "abc_create.up.sql", "SELECT 2;"); // version not numeric → ignored
        write(&dir, "001_too_short.up.sql", "SELECT 3;"); // 3 digits — under min
        write(&dir, "0001_create.up.sql", "SELECT 4;");

        let out = discover(dir.path()).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].version, "0001");
    }

    #[test]
    fn sorts_by_version_lexicographically() {
        let dir = TempDir::new().unwrap();
        write(&dir, "0010_ten.up.sql", "");
        write(&dir, "0009_nine.up.sql", "");
        write(&dir, "0001_one.up.sql", "");

        let out = discover(dir.path()).unwrap();
        let versions: Vec<&str> = out.iter().map(|m| m.version.as_str()).collect();
        assert_eq!(versions, vec!["0001", "0009", "0010"]);
    }

    #[test]
    fn empty_dir_returns_empty_list() {
        let dir = TempDir::new().unwrap();
        let out = discover(dir.path()).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn nonexistent_dir_returns_io_error() {
        let result = discover(Path::new("/nonexistent_ide99_test_path_zzzz"));
        match result {
            Err(MigrationsError::Io(_)) => {}
            other => panic!("expected MigrationsError::Io, got {other:?}"),
        }
    }

    #[test]
    fn computes_sha256_checksum_hex() {
        // Known vector: SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(
            checksum_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // Empty input
        assert_eq!(
            checksum_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // Determinism
        assert_eq!(checksum_hex(b"hello"), checksum_hex(b"hello"));
    }

    #[test]
    fn detects_no_transaction_magic_comment() {
        assert!(has_no_transaction_directive(
            "-- ide99:no-transaction\nCREATE INDEX CONCURRENTLY ..."
        ));
        // Leading blank lines OK.
        assert!(has_no_transaction_directive(
            "\n\n   \n-- ide99:no-transaction\nSELECT 1;"
        ));
        // Trimmed whitespace around the line OK.
        assert!(has_no_transaction_directive(
            "  -- ide99:no-transaction  \nSELECT 1;"
        ));
    }

    #[test]
    fn rejects_no_transaction_when_not_first_line() {
        // Magic comment on line 2 — first non-blank is "SELECT 1;"
        assert!(!has_no_transaction_directive(
            "SELECT 1;\n-- ide99:no-transaction"
        ));
        // Trailing text on the magic line — not exact match.
        assert!(!has_no_transaction_directive(
            "-- ide99:no-transaction please\nSELECT 1;"
        ));
        // Different comment — no match.
        assert!(!has_no_transaction_directive("-- some-other-comment\n"));
        // Empty input
        assert!(!has_no_transaction_directive(""));
    }

    #[test]
    fn contiguous_range_helper() {
        let pending: Vec<String> = vec!["0001", "0002", "0003", "0004"]
            .into_iter()
            .map(String::from)
            .collect();
        assert!(is_contiguous_range(&pending, "0001", "0003"));
        assert!(is_contiguous_range(&pending, "0002", "0002"));
        assert!(is_contiguous_range(&pending, "0001", "0004"));
        // from > to → not valid
        assert!(!is_contiguous_range(&pending, "0003", "0001"));
        // from missing
        assert!(!is_contiguous_range(&pending, "9999", "0002"));
        // to missing
        assert!(!is_contiguous_range(&pending, "0001", "9999"));
    }
}
