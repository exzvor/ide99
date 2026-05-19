//! Tauri command surface for paid-module gates.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use tauri::State;

use crate::modules::manager;
use crate::modules::types::{ActionPreflight, ModuleError, ModuleId, SubscriptionState};
use crate::AppState;

#[tauri::command]
pub async fn modules_get_state(    state: State<'_, AppState>,
) -> Result<SubscriptionState, ModuleError> {
    state.modules_get_state().await
}

#[tauri::command]
pub async fn modules_pre_flight(    state: State<'_, AppState>,
    module: ModuleId,
) -> Result<ActionPreflight, ModuleError> {
    state.modules_pre_flight(module).await
}

impl AppState {
    pub async fn modules_get_state(&self) -> Result<SubscriptionState, ModuleError> {
        let store = self.store.lock().await;
        manager::read_state(store.conn())
    }

    pub async fn modules_pre_flight(        &self,
        module: ModuleId,
) -> Result<ActionPreflight, ModuleError> {
        let state = self.modules_get_state().await?;
        Ok(manager::pre_flight(&state, module))
    }
}
