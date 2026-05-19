//! — user snippet manager.
//!
//! Storage lives in `store.db` alongside the connections / history tables.
//! Built-in snippets are TS-side const arrays (frozen, immutable) — this
//! module owns ONLY user-created snippets.

pub mod commands;
pub mod store;
pub mod types;
