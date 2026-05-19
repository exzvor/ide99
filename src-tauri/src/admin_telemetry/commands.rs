//! Tauri commands for admin telemetry. Privacy-gated at the JS layer (the
//! frontend reads `useAppSettings` and skips emit when telemetry is off);
//! commands here intentionally don't re-check settings to keep them cheap.

use serde_json::Value;
use tauri::State;

use super::client;
use crate::AppState;

#[tauri::command]
pub async fn admin_telemetry_emit(    state: State<'_, AppState>,
    locale: String,
    event_name: String,
    payload: Option<Value>,
) -> Result<(), String> {
    let data_dir = state.data_dir.clone();
    let payload = payload.unwrap_or_else(|| serde_json::json!({}));
    tauri::async_runtime::spawn(async move {
        client::emit(&data_dir, &locale, &event_name, payload).await;
    });
    Ok(())
}
