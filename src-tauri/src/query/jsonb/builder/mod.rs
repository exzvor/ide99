//! — JSONB Query Builder backend module.
//!
//! Public surface: `jsonb_builder_preview` Tauri command (defined in `commands.rs`
//! once Phase 2 /). For Phase 1 the module
//! re-exports types only.

pub mod commands;
pub mod sql_gen;
pub mod types;
