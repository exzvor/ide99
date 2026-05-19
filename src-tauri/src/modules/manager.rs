//! Subscription state queries + pre-flight gate for paid-module actions.
//!
//! reads subscription flags from `app_settings` (migration 015).
//! Sub-agents C/D consume `pre_flight` from frontend slot components. v1.1+
//! `sign_in_*` will flip the flags after OAuth roundtrip.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use crate::modules::types::{ActionPreflight, ModuleError, ModuleId, SubscriptionState};
use crate::telemetry::store as settings_store;
use rusqlite::Connection;

pub fn read_state(conn: &Connection) -> Result<SubscriptionState, ModuleError> {
    let app = settings_store::read(conn).map_err(|e| ModuleError::Storage(e.to_string()))?;
    let mut state = SubscriptionState::default();
    state.spg99_subscribed = app.spg99_subscribed;
    state.vibepg_subscribed = app.vibepg_subscribed;
    Ok(state)
}

#[must_use]
pub fn pre_flight(state: &SubscriptionState, module: ModuleId) -> ActionPreflight {
    let (subscribed, upgrade_url) = match module {
        ModuleId::Spg99 => (state.spg99_subscribed, state.upgrade_url_spg99.clone()),
        ModuleId::Vibepg => (state.vibepg_subscribed, state.upgrade_url_vibepg.clone()),
    };
    if subscribed {
        ActionPreflight {
            module,
            allowed: true,
            upgrade_url: None,
            reason_key: "modules.action.allowed".into(),
        }
    } else {
        ActionPreflight {
            module,
            allowed: false,
            upgrade_url: Some(upgrade_url),
            reason_key: format!("modules.action.upgrade_required.{}", module.as_str()),
        }
    }
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
    fn fresh_install_has_no_subscriptions() {
        let store = fresh_store();
        let state = read_state(store.conn()).unwrap();
        assert!(!state.spg99_subscribed);
        assert!(!state.vibepg_subscribed);
        assert!(state.upgrade_url_spg99.contains("spg99"));
        assert!(state.upgrade_url_vibepg.contains("vibepg"));
    }

    #[test]
    fn pre_flight_blocks_unsubscribed_user() {
        let state = SubscriptionState::default();
        let pf = pre_flight(&state, ModuleId::Spg99);
        assert!(!pf.allowed);
        assert!(pf.upgrade_url.is_some());
        assert_eq!(pf.reason_key, "modules.action.upgrade_required.spg99");
    }

    #[test]
    fn pre_flight_allows_subscribed_user() {
        let mut state = SubscriptionState::default();
        state.spg99_subscribed = true;
        let pf = pre_flight(&state, ModuleId::Spg99);
        assert!(pf.allowed);
        assert!(pf.upgrade_url.is_none());
        assert_eq!(pf.reason_key, "modules.action.allowed");
    }

    #[test]
    fn pre_flight_per_module_independent() {
        let mut state = SubscriptionState::default();
        state.spg99_subscribed = true;
        state.vibepg_subscribed = false;
        assert!(pre_flight(&state, ModuleId::Spg99).allowed);
        assert!(!pre_flight(&state, ModuleId::Vibepg).allowed);
    }
}
