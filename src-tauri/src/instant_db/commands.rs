//! Tauri commands surfaced to the frontend.

use serde::Serialize;
use tauri::State;

use super::client::{self, InstantDbCreate, InstantDbError, InstantDbStatus};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstantDbCreateView {
    pub db_id: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub connection_string: String,
    pub created_at: String,
    pub expires_at: String,
    pub ttl_seconds: u64,
}

impl From<InstantDbCreate> for InstantDbCreateView {
    fn from(v: InstantDbCreate) -> Self {
        Self {
            db_id: v.db_id,
            host: v.host,
            port: v.port,
            database: v.database,
            username: v.username,
            password: v.password,
            connection_string: v.connection_string,
            created_at: v.created_at,
            expires_at: v.expires_at,
            ttl_seconds: v.ttl_seconds,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstantDbStatusView {
    pub db_id: String,
    pub status: String,
    pub expires_at: String,
    pub seconds_remaining: i64,
}

impl From<InstantDbStatus> for InstantDbStatusView {
    fn from(v: InstantDbStatus) -> Self {
        Self {
            db_id: v.db_id,
            status: v.status,
            expires_at: v.expires_at,
            seconds_remaining: v.seconds_remaining,
        }
    }
}

fn map_err(e: InstantDbError) -> String {
    match e {
        InstantDbError::Server { status, body } => {
            format!("server {status}: {body}")
        }
        other => other.to_string(),
    }
}

#[tauri::command]
pub async fn instant_db_create(
    state: State<'_, AppState>,
    locale: String,
) -> Result<InstantDbCreateView, String> {
    client::create(&state.data_dir, &locale)
        .await
        .map(InstantDbCreateView::from)
        .map_err(map_err)
}

#[tauri::command]
pub async fn instant_db_status(
    state: State<'_, AppState>,
    locale: String,
    db_id: String,
) -> Result<InstantDbStatusView, String> {
    client::status(&state.data_dir, &locale, &db_id)
        .await
        .map(InstantDbStatusView::from)
        .map_err(map_err)
}

#[tauri::command]
pub async fn instant_db_heartbeat(
    state: State<'_, AppState>,
    locale: String,
    db_id: String,
) -> Result<InstantDbStatusView, String> {
    client::heartbeat(&state.data_dir, &locale, &db_id)
        .await
        .map(InstantDbStatusView::from)
        .map_err(map_err)
}

#[tauri::command]
pub async fn instant_db_delete(
    state: State<'_, AppState>,
    locale: String,
    db_id: String,
) -> Result<(), String> {
    client::delete(&state.data_dir, &locale, &db_id)
        .await
        .map_err(map_err)
}
