//! Singleton `app_settings` row CRUD (migration 014).
//!
//! Single-row design (id = 1) — UPSERT is already performed by the
//! migration; reads always
//! find the row. `device_uuid` is generated lazily on first opt-in.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::telemetry::types::{AppSettings, TelemetryEndpoint, TelemetryError};

fn map_storage(e: &rusqlite::Error) -> TelemetryError {
    TelemetryError::Storage(e.to_string())
}

/// Read the singleton row. Returns Err only on storage failure.
pub fn read(conn: &Connection) -> Result<AppSettings, TelemetryError> {
    conn.query_row(        "SELECT telemetry_enabled, crash_reports_enabled, telemetry_endpoint, \
                device_uuid, onboarding_completed, privacy_choice_made, \
                privacy_choice_made_at, release_channel, last_update_check_at, \
                spg99_subscribed, vibepg_subscribed, created_at, updated_at \
         FROM app_settings WHERE id = 1",
        [],
        |row| {
            let endpoint: String = row.get(2)?;
            Ok(AppSettings {
                telemetry_enabled: row.get::<_, i64>(0)? != 0,
                crash_reports_enabled: row.get::<_, i64>(1)? != 0,
                telemetry_endpoint: TelemetryEndpoint::from_str_lossy(&endpoint),
                device_uuid: row.get(3)?,
                onboarding_completed: row.get::<_, i64>(4)? != 0,
                privacy_choice_made: row.get::<_, i64>(5)? != 0,
                privacy_choice_made_at: row.get(6)?,
                release_channel: row.get(7)?,
                last_update_check_at: row.get(8)?,
                spg99_subscribed: row.get::<_, i64>(9)? != 0,
                vibepg_subscribed: row.get::<_, i64>(10)? != 0,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        },
)
    .map_err(|e| map_storage(&e))
}

/// Write all settings at once (frontend always pushes a full snapshot).
/// `device_uuid` regenerated lazily — if the new value flips telemetry
/// on AND the existing UUID is None, mint a fresh one.
pub fn write(conn: &Connection, mut next: AppSettings) -> Result<AppSettings, TelemetryError> {
    let now = Utc::now().to_rfc3339();
    if (next.telemetry_enabled || next.crash_reports_enabled) && next.device_uuid.is_none() {
        next.device_uuid = Some(Uuid::new_v4().to_string());
    }
    conn.execute(        "UPDATE app_settings SET \
            telemetry_enabled = ?1, \
            crash_reports_enabled = ?2, \
            telemetry_endpoint = ?3, \
            device_uuid = ?4, \
            onboarding_completed = ?5, \
            privacy_choice_made = ?6, \
            privacy_choice_made_at = ?7, \
            release_channel = ?8, \
            last_update_check_at = ?9, \
            spg99_subscribed = ?10, \
            vibepg_subscribed = ?11, \
            updated_at = ?12 \
         WHERE id = 1",
        params![
            i64::from(next.telemetry_enabled),
            i64::from(next.crash_reports_enabled),
            next.telemetry_endpoint.as_str(),
            next.device_uuid,
            i64::from(next.onboarding_completed),
            i64::from(next.privacy_choice_made),
            next.privacy_choice_made_at,
            next.release_channel,
            next.last_update_check_at,
            i64::from(next.spg99_subscribed),
            i64::from(next.vibepg_subscribed),
            now,
        ],
)
    .map_err(|e| map_storage(&e))?;
    read(conn)
}

/// Reset device UUID + flip everything off. Mirror the "Clear my data"
/// Settings action.
pub fn clear_all(conn: &Connection) -> Result<AppSettings, TelemetryError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(        "UPDATE app_settings SET \
            telemetry_enabled = 0, \
            crash_reports_enabled = 0, \
            device_uuid = NULL, \
            privacy_choice_made = 0, \
            privacy_choice_made_at = NULL, \
            updated_at = ?1 \
         WHERE id = 1",
        params![now],
)
    .map_err(|e| map_storage(&e))?;
    read(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::Store;

    fn fresh_store() -> Store {
        let mut s = Store::open_in_memory().expect("open mem store");
        s.run_migrations().expect("migrations");
        s
    }

    #[test]
    fn read_returns_default_singleton() {
        let store = fresh_store();
        let s = read(store.conn()).expect("read");
        assert!(!s.telemetry_enabled);
        assert!(!s.crash_reports_enabled);
        assert_eq!(s.telemetry_endpoint, TelemetryEndpoint::Eu);
        assert!(s.device_uuid.is_none());
        assert!(!s.privacy_choice_made);
    }

    #[test]
    fn write_mints_device_uuid_on_first_opt_in() {
        let store = fresh_store();
        let mut s = read(store.conn()).unwrap();
        s.telemetry_enabled = true;
        s.privacy_choice_made = true;
        let saved = write(store.conn(), s).expect("write");
        assert!(saved.telemetry_enabled);
        assert!(saved.device_uuid.is_some());
        assert_eq!(saved.device_uuid.as_deref().unwrap().len(), 36); // uuid hyphenated
    }

    #[test]
    fn write_preserves_existing_uuid() {
        let store = fresh_store();
        let mut s = read(store.conn()).unwrap();
        s.telemetry_enabled = true;
        let first = write(store.conn(), s).unwrap();
        let mut second_input = first.clone();
        second_input.crash_reports_enabled = true;
        let second = write(store.conn(), second_input).unwrap();
        assert_eq!(first.device_uuid, second.device_uuid);
    }

    #[test]
    fn clear_all_wipes_uuid_and_flags() {
        let store = fresh_store();
        let mut s = read(store.conn()).unwrap();
        s.telemetry_enabled = true;
        write(store.conn(), s).unwrap();
        let cleared = clear_all(store.conn()).unwrap();
        assert!(!cleared.telemetry_enabled);
        assert!(cleared.device_uuid.is_none());
        assert!(!cleared.privacy_choice_made);
    }

    #[test]
    fn endpoint_roundtrip() {
        let store = fresh_store();
        let mut s = read(store.conn()).unwrap();
        s.telemetry_endpoint = TelemetryEndpoint::Ru;
        let saved = write(store.conn(), s).unwrap();
        assert_eq!(saved.telemetry_endpoint, TelemetryEndpoint::Ru);
    }
}
