//! `SQLite` persistence for connections.
//!
//! Single-connection rusqlite handle — connection manager state is small (low
//! hundreds of rows max) and all writes go through the `Mutex<Store>` in
//! `AppState`, so a pool would be over-engineering at this layer.

// Internal crate-private API — error/panic conditions are exhaustively tested
// rather than enumerated in rustdoc.
#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::path::Path;

use chrono::Utc;
use rusqlite::{params, Connection as SqliteConnection, OptionalExtension};
use uuid::Uuid;

use crate::connection::types::{
    Connection, ConnectionError, Environment, NewConnection, SslMode, UpdateConnection,
};

/// Embedded migrations applied in-order by `run_migrations`. Adding a new entry
/// is the only way to evolve the schema ; future sprints may switch to a
/// dedicated migrator crate when more files appear.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/001_connections.sql")),
    (2, include_str!("../../migrations/002_editor_tabs.sql")),
    (3, include_str!("../../migrations/003_query_history.sql")),
    (4, include_str!("../../migrations/004_user_snippets.sql")),
    (
        5,
        include_str!("../../migrations/005_environment_labels.sql"),
    ),
    (6, include_str!("../../migrations/006_recent_plans.sql")),
    (
        7,
        include_str!("../../migrations/007_editor_tabs_plan_diff.sql"),
    ),
    (8, include_str!("../../migrations/008_health_snapshots.sql")),
    (
        9,
        include_str!("../../migrations/009_jsonb_inferred_schemas.sql"),
    ),
    (
        10,
        include_str!("../../migrations/010_migration_settings.sql"),
    ),
    (11, include_str!("../../migrations/011_squawk_lint.sql")),
    // — MCP authorized clients table. Owned by `mcp::store_migration`;
    // mounted here because all migrations live under one ledger.
    (12, include_str!("../../migrations/012_mcp_clients.sql")),
    // — Notebook auto-save (cells_json blob per notebook).
    (13, include_str!("../../migrations/013_notebooks.sql")),
    // — singleton `app_settings` row (privacy + onboarding flags).
    (14, include_str!("../../migrations/014_app_settings.sql")),
    // — release channel + paid-module subscription flags.
    (
        15,
        include_str!("../../migrations/015_release_settings.sql"),
    ),
];

/// Test-only accessor — keeps the embedded MIGRATIONS array private but lets
/// migration-counting assertions in sister modules stay in sync as new
/// migrations land.
#[must_use]
pub const fn migrations_count() -> usize {
    MIGRATIONS.len()
}

pub struct Store {
    conn: SqliteConnection,
}

impl Store {
    /// Open or create a database at `path`. Parent directory must already
    /// exist (handled by `app_paths::data_dir`).
    pub fn open(path: &Path) -> Result<Self, ConnectionError> {
        let conn = SqliteConnection::open(path).map_err(|e| map_storage(&e))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| map_storage(&e))?;
        Ok(Self { conn })
    }

    /// In-memory variant — used by unit tests so we don't touch the real fs.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, ConnectionError> {
        let conn = SqliteConnection::open_in_memory().map_err(|e| map_storage(&e))?;
        Ok(Self { conn })
    }

    /// Borrow the underlying rusqlite handle. Used by the `query::tabs` module
    /// to read/write the `editor_tabs` table while sharing the same `Mutex`
    /// guard the connection rows live behind.
    #[must_use]
    pub const fn conn(&self) -> &SqliteConnection {
        &self.conn
    }

    /// Mutable borrow of the rusqlite handle, needed by callers that open a
    /// transaction (`query::recent_plans::save` runs INSERT + LRU DELETE in
    /// one tx). Sister to `conn()`.
    pub const fn conn_mut(&mut self) -> &mut SqliteConnection {
        &mut self.conn
    }

    /// Apply any embedded migrations whose version is not yet recorded in
    /// `schema_migrations`. Each migration runs in its own transaction.
    pub fn run_migrations(&mut self) -> Result<(), ConnectionError> {
        // Bootstrap: the first migration creates `schema_migrations` itself, so
        // we cannot read it yet. Use IF NOT EXISTS in the migration body and
        // gate insertion on a post-apply check.
        for (version, sql) in MIGRATIONS {
            let table_exists = self
                .conn
                .query_row(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
                    [],
                    |_| Ok(true),
                )
                .optional()
                .map_err(|e| map_storage(&e))?
                .unwrap_or(false);
            let already_applied = table_exists
                && self
                    .conn
                    .query_row(
                        "SELECT 1 FROM schema_migrations WHERE version = ?1",
                        params![version],
                        |_| Ok(true),
                    )
                    .optional()
                    .map_err(|e| map_storage(&e))?
                    .is_some();

            if already_applied {
                continue;
            }

            let tx = self.conn.transaction().map_err(|e| map_storage(&e))?;
            tx.execute_batch(sql).map_err(|e| map_storage(&e))?;
            tx.execute(
                "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, Utc::now().to_rfc3339()],
            )
            .map_err(|e| map_storage(&e))?;
            tx.commit().map_err(|e| map_storage(&e))?;
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<Connection>, ConnectionError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, host, port, database, username, ssl_mode, has_password, \
                 created_at, updated_at, last_tested_at, last_test_ok, exclude_from_history, \
                 exclude_from_recent_plans, \
                 environment, read_only, slow_query_warning, confirm_destructive, \
                 migrations_dir, migration_tracking_enabled, migration_snapshots_enabled, \
                 squawk_lint_enabled \
                 FROM connections ORDER BY name",
            )
            .map_err(|e| map_storage(&e))?;
        let rows = stmt
            .query_map([], row_to_connection)
            .map_err(|e| map_storage(&e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| map_storage(&e))?);
        }
        Ok(out)
    }

    pub fn get_by_id(&self, id: &str) -> Result<Connection, ConnectionError> {
        self.conn
            .query_row(
                "SELECT id, name, host, port, database, username, ssl_mode, has_password, \
                 created_at, updated_at, last_tested_at, last_test_ok, exclude_from_history, \
                 exclude_from_recent_plans, \
                 environment, read_only, slow_query_warning, confirm_destructive, \
                 migrations_dir, migration_tracking_enabled, migration_snapshots_enabled, \
                 squawk_lint_enabled \
                 FROM connections WHERE id = ?1",
                params![id],
                row_to_connection,
            )
            .map_err(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => ConnectionError::NotFound(id.to_string()),
                ref other => map_storage(other),
            })
    }

    pub fn create(
        &self,
        input: &NewConnection,
        password_present: bool,
    ) -> Result<Connection, ConnectionError> {
        validate_input(&input.name, &input.host, &input.database, &input.username)?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        self.conn
            .execute(                "INSERT INTO connections \
                 (id, name, host, port, database, username, ssl_mode, has_password, \
                  exclude_from_history, exclude_from_recent_plans, created_at, updated_at, \
                  environment, read_only, slow_query_warning, confirm_destructive, \
                  migrations_dir, migration_tracking_enabled, migration_snapshots_enabled, \
                  squawk_lint_enabled) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
                params![
                    id,
                    input.name,
                    input.host,
                    input.port,
                    input.database,
                    input.username,
                    input.ssl_mode.as_str(),
                    i64::from(password_present),
                    i64::from(input.exclude_from_history),
                    i64::from(input.exclude_from_recent_plans),
                    now,
                    now,
                    input.environment.as_str(),
                    i64::from(input.read_only),
                    i64::from(input.slow_query_warning),
                    i64::from(input.confirm_destructive),
                    input.migrations_dir,
                    i64::from(input.migration_tracking_enabled),
                    i64::from(input.migration_snapshots_enabled),
                    i64::from(input.squawk_lint_enabled),
                ],
)
            .map_err(|err| map_unique(&err, &input.name))?;

        self.get_by_id(&id)
    }

    pub fn update(
        &self,
        id: &str,
        input: &UpdateConnection,
        has_password: bool,
    ) -> Result<Connection, ConnectionError> {
        validate_input(&input.name, &input.host, &input.database, &input.username)?;
        let now = Utc::now().to_rfc3339();

        let rows = self
            .conn
            .execute(
                "UPDATE connections SET \
                   name = ?1, host = ?2, port = ?3, database = ?4, username = ?5, \
                   ssl_mode = ?6, has_password = ?7, exclude_from_history = ?8, \
                   exclude_from_recent_plans = ?9, updated_at = ?10, \
                   environment = ?11, read_only = ?12, slow_query_warning = ?13, \
                   confirm_destructive = ?14, \
                   migrations_dir = ?15, migration_tracking_enabled = ?16, \
                   migration_snapshots_enabled = ?17, \
                   squawk_lint_enabled = ?18 \
                 WHERE id = ?19",
                params![
                    input.name,
                    input.host,
                    input.port,
                    input.database,
                    input.username,
                    input.ssl_mode.as_str(),
                    i64::from(has_password),
                    i64::from(input.exclude_from_history),
                    i64::from(input.exclude_from_recent_plans),
                    now,
                    input.environment.as_str(),
                    i64::from(input.read_only),
                    i64::from(input.slow_query_warning),
                    i64::from(input.confirm_destructive),
                    input.migrations_dir,
                    i64::from(input.migration_tracking_enabled),
                    i64::from(input.migration_snapshots_enabled),
                    i64::from(input.squawk_lint_enabled),
                    id,
                ],
            )
            .map_err(|err| map_unique(&err, &input.name))?;

        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        self.get_by_id(id)
    }

    pub fn delete(&self, id: &str) -> Result<(), ConnectionError> {
        let rows = self
            .conn
            .execute("DELETE FROM connections WHERE id = ?1", params![id])
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Flip the `has_password` flag in-place. Used by the connect path when
    /// the `keychain` returns no entry for a row that `SQLite` says has one —
    /// dev-mode binary signature drift on macOS routinely invalidates
    /// keychain ACLs, so the row's belief becomes stale. Updating the flag
    /// keeps the Edit form / list UI honest (it can show "no saved password"
    /// instead of "Leave blank to keep current").
    pub fn set_has_password(&self, id: &str, has_password: bool) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET has_password = ?1, updated_at = ?2 WHERE id = ?3",
                params![i64::from(has_password), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Granular setter for the History opt-out flag. Used by the connection-level
    /// IPC command without forcing callers to re-submit the entire form payload.
    pub fn set_exclude_from_history(&self, id: &str, value: bool) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET exclude_from_history = ?1, updated_at = ?2 WHERE id = ?3",
                params![i64::from(value), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// — granular setter for the Recent Plans opt-out flag. Mirror
    /// of `set_exclude_from_history` .
    pub fn set_exclude_from_recent_plans(
        &self,
        id: &str,
        value: bool,
    ) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET exclude_from_recent_plans = ?1, updated_at = ?2 \
                 WHERE id = ?3",
                params![i64::from(value), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// — per-connection environment tag setter.
    pub fn set_environment(&self, id: &str, env: Environment) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET environment = ?1, updated_at = ?2 WHERE id = ?3",
                params![env.as_str(), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn set_read_only(&self, id: &str, value: bool) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET read_only = ?1, updated_at = ?2 WHERE id = ?3",
                params![i64::from(value), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn set_slow_query_warning(&self, id: &str, value: bool) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET slow_query_warning = ?1, updated_at = ?2 WHERE id = ?3",
                params![i64::from(value), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn set_confirm_destructive(&self, id: &str, value: bool) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET confirm_destructive = ?1, updated_at = ?2 WHERE id = ?3",
                params![i64::from(value), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// — set or clear the migrations directory path.
    pub fn set_migrations_dir(&self, id: &str, value: Option<&str>) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET migrations_dir = ?1, updated_at = ?2 WHERE id = ?3",
                params![value, now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// — toggle the `ide99_migrations` ledger opt-in.
    pub fn set_migration_tracking_enabled(
        &self,
        id: &str,
        value: bool,
    ) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET migration_tracking_enabled = ?1, updated_at = ?2 \
                 WHERE id = ?3",
                params![i64::from(value), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// — toggle schema-snapshot capture on apply.
    pub fn set_migration_snapshots_enabled(
        &self,
        id: &str,
        value: bool,
    ) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET migration_snapshots_enabled = ?1, updated_at = ?2 \
                 WHERE id = ?3",
                params![i64::from(value), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// — toggle the Squawk lint integration on/off per connection.
    pub fn set_squawk_lint_enabled(&self, id: &str, value: bool) -> Result<(), ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET squawk_lint_enabled = ?1, updated_at = ?2 WHERE id = ?3",
                params![i64::from(value), now, id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn record_test_result(&self, id: &str, ok: bool, at: &str) -> Result<(), ConnectionError> {
        let rows = self
            .conn
            .execute(
                "UPDATE connections SET last_tested_at = ?1, last_test_ok = ?2 WHERE id = ?3",
                params![at, i64::from(ok), id],
            )
            .map_err(|e| map_storage(&e))?;
        if rows == 0 {
            return Err(ConnectionError::NotFound(id.to_string()));
        }
        Ok(())
    }
}

fn row_to_connection(row: &rusqlite::Row<'_>) -> rusqlite::Result<Connection> {
    let ssl: String = row.get("ssl_mode")?;
    let port: i64 = row.get("port")?;
    let has_password: i64 = row.get("has_password")?;
    let last_test_ok: Option<i64> = row.get("last_test_ok")?;
    let exclude_from_history: i64 = row.get("exclude_from_history")?;
    let exclude_from_recent_plans: i64 = row.get("exclude_from_recent_plans")?;
    let environment: String = row.get("environment")?;
    let read_only: i64 = row.get("read_only")?;
    let slow_query_warning: i64 = row.get("slow_query_warning")?;
    let confirm_destructive: i64 = row.get("confirm_destructive")?;
    let migrations_dir: Option<String> = row.get("migrations_dir")?;
    let migration_tracking_enabled: i64 = row.get("migration_tracking_enabled")?;
    let migration_snapshots_enabled: i64 = row.get("migration_snapshots_enabled")?;
    let squawk_lint_enabled: i64 = row.get("squawk_lint_enabled")?;

    Ok(Connection {
        id: row.get("id")?,
        name: row.get("name")?,
        host: row.get("host")?,
        port: u16::try_from(port).unwrap_or(5432),
        database: row.get("database")?,
        username: row.get("username")?,
        ssl_mode: SslMode::from_token(&ssl).unwrap_or_default(),
        has_password: has_password != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_tested_at: row.get("last_tested_at")?,
        last_test_ok: last_test_ok.map(|v| v != 0),
        exclude_from_history: exclude_from_history != 0,
        exclude_from_recent_plans: exclude_from_recent_plans != 0,
        environment: Environment::from_str_lossy(&environment),
        read_only: read_only != 0,
        slow_query_warning: slow_query_warning != 0,
        confirm_destructive: confirm_destructive != 0,
        migrations_dir,
        migration_tracking_enabled: migration_tracking_enabled != 0,
        migration_snapshots_enabled: migration_snapshots_enabled != 0,
        squawk_lint_enabled: squawk_lint_enabled != 0,
    })
}

fn validate_input(
    name: &str,
    host: &str,
    database: &str,
    username: &str,
) -> Result<(), ConnectionError> {
    if name.trim().is_empty() {
        return Err(ConnectionError::InvalidInput("name is required".into()));
    }
    if name.chars().count() > 80 {
        return Err(ConnectionError::InvalidInput(
            "name exceeds 80 characters".into(),
        ));
    }
    if host.trim().is_empty() {
        return Err(ConnectionError::InvalidInput("host is required".into()));
    }
    if database.trim().is_empty() {
        return Err(ConnectionError::InvalidInput("database is required".into()));
    }
    if username.trim().is_empty() {
        return Err(ConnectionError::InvalidInput("username is required".into()));
    }
    Ok(())
}

fn map_storage(err: &rusqlite::Error) -> ConnectionError {
    ConnectionError::Storage(err.to_string())
}

/// Map `SQLite` UNIQUE constraint failures on `connections.name` to
/// `DuplicateName` so the UI can show a targeted error.
fn map_unique(err: &rusqlite::Error, name: &str) -> ConnectionError {
    if let rusqlite::Error::SqliteFailure(code, msg) = err {
        if code.code == rusqlite::ErrorCode::ConstraintViolation {
            let msg_lower = msg.as_deref().unwrap_or("").to_ascii_lowercase();
            if msg_lower.contains("connections.name") || msg_lower.contains("unique") {
                return ConnectionError::DuplicateName(name.to_string());
            }
        }
    }
    map_storage(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::types::SslMode;

    fn fresh_store() -> Store {
        let mut store = Store::open_in_memory().unwrap();
        store.run_migrations().unwrap();
        store
    }

    fn sample_input(name: &str) -> NewConnection {
        NewConnection {
            name: name.to_string(),
            host: "localhost".into(),
            port: 5432,
            database: "postgres".into(),
            username: "exzvor".into(),
            password: None,
            ssl_mode: SslMode::Prefer,
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

    #[test]
    fn migrations_idempotent() {
        let mut store = Store::open_in_memory().unwrap();
        store.run_migrations().unwrap();
        store.run_migrations().unwrap();
        let count: i64 = store
            .conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        // added 002_editor_tabs; total = MIGRATIONS.len()
        assert_eq!(count, i64::try_from(super::MIGRATIONS.len()).unwrap());
    }

    #[test]
    fn create_then_list() {
        let store = fresh_store();
        let c = store.create(&sample_input("dev"), false).unwrap();
        assert_eq!(c.name, "dev");
        assert!(!c.has_password);
        let listed = store.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, c.id);
    }

    #[test]
    fn list_orders_by_name() {
        let store = fresh_store();
        store.create(&sample_input("zebra"), false).unwrap();
        store.create(&sample_input("alpha"), false).unwrap();
        store.create(&sample_input("middle"), false).unwrap();
        let listed = store.list().unwrap();
        assert_eq!(
            listed.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["alpha", "middle", "zebra"],
        );
    }

    #[test]
    fn duplicate_name_rejected() {
        let store = fresh_store();
        store.create(&sample_input("dup"), false).unwrap();
        let err = store.create(&sample_input("dup"), false).unwrap_err();
        assert!(matches!(err, ConnectionError::DuplicateName(_)));
    }

    #[test]
    fn delete_returns_not_found_when_missing() {
        let store = fresh_store();
        let err = store.delete("does-not-exist").unwrap_err();
        assert!(matches!(err, ConnectionError::NotFound(_)));
    }

    #[test]
    fn update_round_trip() {
        let store = fresh_store();
        let c = store.create(&sample_input("orig"), false).unwrap();
        let upd = UpdateConnection {
            name: "renamed".into(),
            host: "newhost".into(),
            port: 6543,
            database: "newdb".into(),
            username: "u2".into(),
            password: crate::connection::types::UpdatePassword::Keep,
            ssl_mode: SslMode::Require,
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
        };
        let updated = store.update(&c.id, &upd, true).unwrap();
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.port, 6543);
        assert_eq!(updated.ssl_mode, SslMode::Require);
        assert!(updated.has_password);
    }

    #[test]
    fn record_test_result_sets_columns() {
        let store = fresh_store();
        let c = store.create(&sample_input("rt"), false).unwrap();
        store
            .record_test_result(&c.id, true, "2026-04-27T00:00:00Z")
            .unwrap();
        let after = store.get_by_id(&c.id).unwrap();
        assert_eq!(
            after.last_tested_at.as_deref(),
            Some("2026-04-27T00:00:00Z")
        );
        assert_eq!(after.last_test_ok, Some(true));
    }

    #[test]
    fn invalid_input_rejected() {
        let store = fresh_store();
        let mut bad = sample_input("");
        bad.name.clear();
        let err = store.create(&bad, false).unwrap_err();
        assert!(matches!(err, ConnectionError::InvalidInput(_)));
    }
}
