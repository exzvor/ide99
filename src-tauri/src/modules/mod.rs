//! Paid module manager.
//!
//! ide99 stays fully functional without paid modules. The manager only
//! tracks subscription state and exposes IPC so the UI can decide whether
//! to show "Upgrade" buttons vs real actions.
//!
//! Currently reserved slots:
//! - **Instant DB** (`ModuleId::Spg99`): on-demand throwaway PostgreSQL
//!   instances; backend lives at api.spg99.ru. Currently in free beta.
//! - **AI Agent** (`ModuleId::Vibepg`): reserved for an upcoming AI-agent
//!   module. UI scaffolding only; backend wiring is a future release.
//!
//! **No vendor lock**: the manager API is the same regardless of subscription.
//! Without a subscription, every action returns `Err(NotSubscribed)` and the
//! frontend renders the upgrade page.

pub mod commands;
pub mod manager;
pub mod types;
