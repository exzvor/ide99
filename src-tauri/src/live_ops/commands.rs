//! — three Tauri commands. Each just wires up state.pools →
//! the corresponding fetch_*; bodies stay one-liners.

#![allow(clippy::missing_errors_doc)]

use crate::live_ops::types::{
    LiveOpsError, ReplicationOverview, SessionsMode, SessionsSnapshot, SlowSnapshot, SlowSortBy,
};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn live_ops_sessions(    conn_id: String,
    mode: SessionsMode,
    state: State<'_, AppState>,
) -> Result<SessionsSnapshot, LiveOpsError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(LiveOpsError::NotConnected)?;
    crate::live_ops::sessions::fetch_sessions(&pool, mode).await
}

#[tauri::command]
pub async fn live_ops_slow(    conn_id: String,
    sort_by: SlowSortBy,
    state: State<'_, AppState>,
) -> Result<SlowSnapshot, LiveOpsError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(LiveOpsError::NotConnected)?;
    crate::live_ops::slow::fetch_slow(&pool, sort_by).await
}

#[tauri::command]
pub async fn live_ops_replication(    conn_id: String,
    state: State<'_, AppState>,
) -> Result<ReplicationOverview, LiveOpsError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(LiveOpsError::NotConnected)?;
    crate::live_ops::replication::fetch_replication(&pool).await
}
