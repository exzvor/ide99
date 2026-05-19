//! Migration-set export & import for the `.ide99` envelope.
//!
//! A migration set is a directory of `{NNNN}_{name}.up.sql` / `.down.sql`
//! files. The export inlines the file *contents* (not paths) into the
//! envelope so the receiver can reconstruct the directory anywhere.
//! Apply writes each entry back as a real file under a target dir; the
//! receiver chooses the dir (typically the connection's `migrations_dir`).
//!
//! Privacy: filenames + SQL bodies only. No applied-checksums, no ledger
//! state, no connection bindings.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::file_sharing::types::ShareError;
use crate::migrations::discovery;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedMigrationFile {
    pub version: String,
    pub name: String,
    pub up_sql: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub down_sql: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSet {
    pub label: String,
    pub files: Vec<ExportedMigrationFile>,
}

/// Build payload from a migrations directory (uses `discovery::discover` to
/// pair up/down files and read SQL bodies).
pub fn to_payload(label: &str, dir: &Path) -> Result<serde_json::Value, ShareError> {
    let migs = discovery::discover(dir)
        .map_err(|e| ShareError::Storage(format!("discover {}: {e}", dir.display())))?;
    let mut files: Vec<ExportedMigrationFile> = Vec::with_capacity(migs.len());
    for m in migs {
        if m.parse_error.is_some() {
            // Skip rows discovery flagged (duplicate version, orphan rollback).
            continue;
        }
        if m.up_path.is_empty() {
            continue;
        }
        let up_sql = fs::read_to_string(&m.up_path)
            .map_err(|e| ShareError::Io(format!("read {}: {e}", m.up_path)))?;
        let down_sql = match &m.down_path {
            Some(p) => {
                Some(fs::read_to_string(p).map_err(|e| ShareError::Io(format!("read {p}: {e}")))?)
            }
            None => None,
        };
        files.push(ExportedMigrationFile {
            version: m.version,
            name: m.name,
            up_sql,
            down_sql,
        });
    }
    let set = MigrationSet {
        label: label.to_string(),
        files,
    };
    serde_json::to_value(set)
        .map_err(|e| ShareError::InvalidFile(format!("encode migration-set: {e}")))
}

pub fn from_payload(value: &serde_json::Value) -> Result<MigrationSet, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode migration-set: {e}")))
}

pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let set = from_payload(value)?;
    Ok(format!("{} ({} migrations)", set.label, set.files.len()))
}

/// Apply: writes every file in the set into `dest_dir`. Refuses to overwrite
/// existing files (the receiver should pick a fresh directory or rename).
pub fn apply(value: &serde_json::Value, dest_dir: &Path) -> Result<usize, ShareError> {
    let set = from_payload(value)?;
    if !dest_dir.exists() {
        fs::create_dir_all(dest_dir).map_err(|e| ShareError::Io(e.to_string()))?;
    }
    let mut written = 0_usize;
    for f in &set.files {
        let up_name = format!("{}_{}.up.sql", f.version, f.name);
        let up_path = dest_dir.join(&up_name);
        if up_path.exists() {
            return Err(ShareError::Storage(format!(                "refusing to overwrite existing file: {}",
                up_path.display()
)));
        }
        fs::write(&up_path, &f.up_sql).map_err(|e| ShareError::Io(e.to_string()))?;
        written += 1;
        if let Some(down_sql) = &f.down_sql {
            let down_name = format!("{}_{}.down.sql", f.version, f.name);
            let down_path = dest_dir.join(&down_name);
            if down_path.exists() {
                return Err(ShareError::Storage(format!(                    "refusing to overwrite existing file: {}",
                    down_path.display()
)));
            }
            fs::write(&down_path, down_sql).map_err(|e| ShareError::Io(e.to_string()))?;
        }
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write(dir: &Path, name: &str, body: &str) {
        fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn export_strips_invalid_entries_and_inlines_sql() {
        let dir = tempdir().unwrap();
        write(dir.path(), "0001_create_users.up.sql", "CREATE TABLE u();");
        write(dir.path(), "0001_create_users.down.sql", "DROP TABLE u;");
        write(dir.path(), "0002_lonely.down.sql", "SELECT 1"); // orphan -> filtered
        let payload = to_payload("baseline", dir.path()).unwrap();
        let set = from_payload(&payload).unwrap();
        assert_eq!(set.label, "baseline");
        assert_eq!(set.files.len(), 1);
        assert_eq!(set.files[0].version, "0001");
        assert!(set.files[0].up_sql.contains("CREATE TABLE"));
        assert!(set.files[0].down_sql.as_deref().unwrap().contains("DROP"));
    }

    #[test]
    fn summary_counts_files() {
        let dir = tempdir().unwrap();
        write(dir.path(), "0001_a.up.sql", "");
        write(dir.path(), "0002_b.up.sql", "");
        let payload = to_payload("set-x", dir.path()).unwrap();
        assert_eq!(summary(&payload).unwrap(), "set-x (2 migrations)");
    }

    #[test]
    fn apply_writes_files_and_refuses_overwrite() {
        let src = tempdir().unwrap();
        write(src.path(), "0001_init.up.sql", "CREATE TABLE t();");
        write(src.path(), "0001_init.down.sql", "DROP TABLE t;");
        let payload = to_payload("set", src.path()).unwrap();

        let dst = tempdir().unwrap();
        let n = apply(&payload, dst.path()).unwrap();
        assert_eq!(n, 1);
        assert!(dst.path().join("0001_init.up.sql").exists());
        assert!(dst.path().join("0001_init.down.sql").exists());

        // Re-apply must refuse overwrite.
        let err = apply(&payload, dst.path()).expect_err("must refuse overwrite");
        assert!(matches!(err, ShareError::Storage(_)));
    }
}
