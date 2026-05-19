//! Tauri command surface for telemetry / crash / settings.
//!
//! contract zoned. //! HTTP plumbing.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::collections::BTreeMap;

use tauri::State;

use crate::telemetry::client;
use crate::telemetry::crash;
use crate::telemetry::events;
use crate::telemetry::store;
use crate::telemetry::types::{AppSettings, CrashReport, TelemetryError};
use crate::AppState;

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, TelemetryError> {
    state.settings_get().await
}

#[tauri::command]
pub async fn settings_set(    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, TelemetryError> {
    state.settings_set(settings).await
}

#[tauri::command]
pub async fn settings_clear(state: State<'_, AppState>) -> Result<AppSettings, TelemetryError> {
    state.settings_clear().await
}

#[tauri::command]
pub async fn telemetry_known_events() -> Result<Vec<String>, TelemetryError> {
    Ok(events::known_events()
        .iter()
        .map(|s| (*s).to_string())
        .collect())
}

#[tauri::command]
pub async fn telemetry_send_event(    state: State<'_, AppState>,
    name: String,
    props: BTreeMap<String, String>,
) -> Result<(), TelemetryError> {
    state.telemetry_send_event(&name, props).await
}

#[tauri::command]
pub async fn crash_report_build(    message: String,
    stack: String,
    app_version: String,
) -> Result<CrashReport, TelemetryError> {
    Ok(crash::build_report(&message, &stack, &app_version))
}

#[tauri::command]
pub async fn crash_report_send(    state: State<'_, AppState>,
    report: CrashReport,
) -> Result<(), TelemetryError> {
    state.crash_report_send(report).await
}

impl AppState {
    pub async fn settings_get(&self) -> Result<AppSettings, TelemetryError> {
        let store = self.store.lock().await;
        store::read(store.conn())
    }

    pub async fn settings_set(&self, settings: AppSettings) -> Result<AppSettings, TelemetryError> {
        let store = self.store.lock().await;
        store::write(store.conn(), settings)
    }

    pub async fn settings_clear(&self) -> Result<AppSettings, TelemetryError> {
        let store = self.store.lock().await;
        store::clear_all(store.conn())
    }

    pub async fn telemetry_send_event(        &self,
        name: &str,
        props: BTreeMap<String, String>,
) -> Result<(), TelemetryError> {
        let settings = self.settings_get().await?;
        if !settings.telemetry_enabled {
            return Err(TelemetryError::NotOptedIn);
        }
        let Some(uuid) = settings.device_uuid.clone() else {
            return Err(TelemetryError::NotOptedIn);
        };
        let event = client::build_event(name, &uuid, props)?;
        client::send_event(&settings, event).await
    }

    pub async fn crash_report_send(&self, report: CrashReport) -> Result<(), TelemetryError> {
        let settings = self.settings_get().await?;
        crash::send(&settings, report).await
    }
}
