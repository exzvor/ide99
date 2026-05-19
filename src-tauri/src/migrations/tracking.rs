//! — `ide99_migrations` ledger table CRUD helpers.
//!
//! All functions here operate on a borrowed `tokio_postgres::Client`;
//! pool acquisition happens upstream in `commands.rs`. Errors map to
//! `MigrationsError::Postgres(format!("{e}"))` so the frontend gets a
//! single, consistent error variant for any DB-level failure.
//!
//! Schema (per spec §3.4):
//!
//! ```sql
//! CREATE TABLE IF NOT EXISTS public.ide99_migrations (//! version          text        PRIMARY KEY,
//! name             text        NOT NULL,
//! checksum         text        NOT NULL,
//! applied_at       timestamptz NOT NULL DEFAULT now(),
//! applied_by       text        NOT NULL DEFAULT current_user,
//! duration_ms      integer     NOT NULL,
//! schema_snapshot  bytea       NULL
//!);
//! ```

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use tokio_postgres::Client;

use crate::migrations::types::{Migration, MigrationStatus, MigrationsError};

const CREATE_LEDGER_SQL: &str = "\
CREATE TABLE IF NOT EXISTS public.ide99_migrations (\
    version          text        PRIMARY KEY, \
    name             text        NOT NULL, \
    checksum         text        NOT NULL, \
    applied_at       timestamptz NOT NULL DEFAULT now(), \
    applied_by       text        NOT NULL DEFAULT current_user, \
    duration_ms      integer     NOT NULL, \
    schema_snapshot  bytea       NULL \
);";

/// One ledger row.
#[derive(Debug, Clone)]
pub struct LedgerEntry {
    pub version: String,
    pub name: String,
    pub checksum: String,
    pub applied_at: String, // RFC3339
    pub applied_by: String,
    pub duration_ms: i64,
    pub has_snapshot: bool,
}

fn pg_err(e: tokio_postgres::Error) -> MigrationsError {
    MigrationsError::Postgres(format!("{e}"))
}

/// Idempotent `CREATE TABLE IF NOT EXISTS public.ide99_migrations`.
pub async fn ensure_table(client: &Client) -> Result<(), MigrationsError> {
    client
        .batch_execute(CREATE_LEDGER_SQL)
        .await
        .map_err(pg_err)
}

/// True iff `public.ide99_migrations` exists.
pub async fn table_exists(client: &Client) -> Result<bool, MigrationsError> {
    let row = client
        .query_one(            "SELECT EXISTS (\
                 SELECT 1 FROM information_schema.tables \
                  WHERE table_schema = 'public' \
                    AND table_name = 'ide99_migrations' \
) AS present",
            &[],
)
        .await
        .map_err(pg_err)?;
    Ok(row.get::<_, bool>("present"))
}

/// Read every row, ordered by version ascending. Returns `[]` if the table
/// doesn't exist.
pub async fn list_applied(client: &Client) -> Result<Vec<LedgerEntry>, MigrationsError> {
    if !table_exists(client).await? {
        return Ok(Vec::new());
    }
    let rows = client
        .query(            "SELECT version, name, checksum, applied_at, applied_by, duration_ms, \
                    (schema_snapshot IS NOT NULL) AS has_snapshot \
               FROM public.ide99_migrations \
              ORDER BY version ASC",
            &[],
)
        .await
        .map_err(pg_err)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let applied_at: DateTime<Utc> = row.get("applied_at");
        out.push(LedgerEntry {
            version: row.get("version"),
            name: row.get("name"),
            checksum: row.get("checksum"),
            applied_at: applied_at.to_rfc3339(),
            applied_by: row.get("applied_by"),
            duration_ms: i64::from(row.get::<_, i32>("duration_ms")),
            has_snapshot: row.get("has_snapshot"),
        });
    }
    Ok(out)
}

/// Insert a row recording an applied migration. The `applied_at` and
/// `applied_by` columns get DB defaults (`now()` / `current_user`).
pub async fn insert(    client: &Client,
    version: &str,
    name: &str,
    checksum: &str,
    duration_ms: i64,
) -> Result<(), MigrationsError> {
    // Postgres `integer` is i32; clamp/convert duration safely.
    let duration_i32 = i32::try_from(duration_ms).unwrap_or(i32::MAX);
    client
        .execute(            "INSERT INTO public.ide99_migrations (version, name, checksum, duration_ms) \
             VALUES ($1, $2, $3, $4)",
            &[&version, &name, &checksum, &duration_i32],
)
        .await
        .map_err(pg_err)?;
    Ok(())
}

/// Remove the ledger row for `version`. No-op if the row doesn't exist
/// (rollback orchestrator checks existence first).
pub async fn delete(client: &Client, version: &str) -> Result<(), MigrationsError> {
    client
        .execute(            "DELETE FROM public.ide99_migrations WHERE version = $1",
            &[&version],
)
        .await
        .map_err(pg_err)?;
    Ok(())
}

/// Store a (gzipped JSON) schema snapshot blob in the row.
pub async fn set_snapshot(    client: &Client,
    version: &str,
    gzipped_bytes: &[u8],
) -> Result<(), MigrationsError> {
    client
        .execute(            "UPDATE public.ide99_migrations SET schema_snapshot = $1 WHERE version = $2",
            &[&gzipped_bytes, &version],
)
        .await
        .map_err(pg_err)?;
    Ok(())
}

/// Fetch a stored snapshot blob if any.
pub async fn get_snapshot(    client: &Client,
    version: &str,
) -> Result<Option<Vec<u8>>, MigrationsError> {
    let row = client
        .query_opt(            "SELECT schema_snapshot FROM public.ide99_migrations WHERE version = $1",
            &[&version],
)
        .await
        .map_err(pg_err)?;
    Ok(row.and_then(|r| r.get::<_, Option<Vec<u8>>>("schema_snapshot")))
}

/// Reconcile a disk `Vec<Migration>` with `ledger` rows.
///
/// - Disk + ledger + checksum match → `Applied`.
/// - Disk + ledger + checksum differs → `Dirty`.
/// - Disk only → `Pending`.
/// - Ledger only → appended as a `Migration` with empty `up_path` and
/// `parse_error = "file missing"` so the timeline can show "applied (file
/// missing)" with a disabled rollback button.
///
/// Returns a fresh `Vec<Migration>` sorted by version.
#[must_use]
pub fn join_with_ledger(disk: Vec<Migration>, ledger: Vec<LedgerEntry>) -> Vec<Migration> {
    let mut by_version: HashMap<String, LedgerEntry> =
        ledger.into_iter().map(|e| (e.version.clone(), e)).collect();

    let mut out: Vec<Migration> = Vec::with_capacity(disk.len());

    for mut m in disk {
        if let Some(entry) = by_version.remove(&m.version) {
            // If the disk entry already has a parse_error (orphan, duplicate)
            // we keep it as-is but still surface ledger metadata so the FE
            // can render context.
            let status = if m.parse_error.is_some() {
                m.status
            } else if m.disk_checksum == entry.checksum {
                MigrationStatus::Applied
            } else {
                MigrationStatus::Dirty
            };
            m.status = status;
            m.applied_at = Some(entry.applied_at);
            m.applied_by = Some(entry.applied_by);
            m.duration_ms = Some(entry.duration_ms);
            m.applied_checksum = Some(entry.checksum);
            m.has_snapshot = entry.has_snapshot;
        }
        out.push(m);
    }

    // Surface ledger-only rows as "file missing" entries (per spec §6.6).
    let mut leftovers: Vec<LedgerEntry> = by_version.into_values().collect();
    leftovers.sort_by(|a, b| a.version.cmp(&b.version));
    for entry in leftovers {
        out.push(Migration {
            version: entry.version,
            name: entry.name,
            up_path: String::new(),
            down_path: None,
            status: MigrationStatus::Applied,
            applied_at: Some(entry.applied_at),
            applied_by: Some(entry.applied_by),
            duration_ms: Some(entry.duration_ms),
            disk_checksum: String::new(),
            applied_checksum: Some(entry.checksum),
            has_snapshot: entry.has_snapshot,
            parse_error: Some("file missing".into()),
        });
    }

    out.sort_by(|a, b| a.version.cmp(&b.version));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use testcontainers::runners::AsyncRunner;
    use testcontainers::ContainerAsync;
    use testcontainers_modules::postgres::Postgres;
    use tokio_postgres::NoTls;

    /// Spin up a fresh PG container + return a connected `Client`.
    /// Returns `None` if Docker is unavailable so the test skips gracefully
    /// (matches the project's other testcontainer suites).
    async fn make_client() -> Option<(ContainerAsync<Postgres>, Client)> {
        let container = match Postgres::default().start().await {
            Ok(c) => c,
            Err(err) => {
                eprintln!("skipping tracking test: docker unavailable ({err})");
                return None;
            }
        };
        let host_port = container.get_host_port_ipv4(5432).await.ok()?;
        let mut cfg = tokio_postgres::Config::new();
        cfg.host("127.0.0.1")
            .port(host_port)
            .dbname("postgres")
            .user("postgres")
            .password("postgres");
        let (client, conn) = cfg.connect(NoTls).await.ok()?;
        tokio::spawn(conn);
        Some((container, client))
    }

    #[tokio::test]
    async fn ensure_table_creates_when_missing() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        assert!(!table_exists(&client).await.unwrap());
        ensure_table(&client).await.unwrap();
        assert!(table_exists(&client).await.unwrap());
        // SELECT works.
        let rows = client
            .query("SELECT count(*) AS c FROM public.ide99_migrations", &[])
            .await
            .unwrap();
        assert_eq!(rows[0].get::<_, i64>("c"), 0);
    }

    #[tokio::test]
    async fn ensure_table_idempotent() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        ensure_table(&client).await.unwrap();
        ensure_table(&client).await.unwrap();
        ensure_table(&client).await.unwrap();
        assert!(table_exists(&client).await.unwrap());
    }

    #[tokio::test]
    async fn insert_then_query_round_trip() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        ensure_table(&client).await.unwrap();
        insert(&client, "0001", "create_users", "deadbeef", 123)
            .await
            .unwrap();
        let rows = list_applied(&client).await.unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.version, "0001");
        assert_eq!(r.name, "create_users");
        assert_eq!(r.checksum, "deadbeef");
        assert_eq!(r.duration_ms, 123);
        assert!(!r.has_snapshot);
        // applied_at parses as RFC3339.
        DateTime::parse_from_rfc3339(&r.applied_at).expect("rfc3339");
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        ensure_table(&client).await.unwrap();
        insert(&client, "0001", "a", "x", 1).await.unwrap();
        insert(&client, "0002", "b", "y", 2).await.unwrap();
        delete(&client, "0001").await.unwrap();
        let rows = list_applied(&client).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].version, "0002");
    }

    #[tokio::test]
    async fn update_snapshot_sets_bytea() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        ensure_table(&client).await.unwrap();
        insert(&client, "0001", "snap", "z", 5).await.unwrap();

        let blob: Vec<u8> = vec![0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00];
        set_snapshot(&client, "0001", &blob).await.unwrap();

        let rows = list_applied(&client).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].has_snapshot);

        let fetched = get_snapshot(&client, "0001").await.unwrap().unwrap();
        assert_eq!(fetched, blob);

        // Missing version → None
        let none = get_snapshot(&client, "9999").await.unwrap();
        assert!(none.is_none());
    }
}
