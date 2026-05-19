//! — GIN Index Suggester backend module.
//!
//! Public surface: `jsonb_suggester_run` and `jsonb_suggester_hypothetical_explain`
//! Tauri commands (defined in `commands.rs`). Sub-modules:
//! - `miner` — regex extraction from `pg_stat_statements`
//! - `op_class` — pure op-class derivation + index naming helpers
//! - `hypopg` — `HypoPG` extension probe + hypothetical EXPLAIN wrapper
//! - `size_estimate` — pg_class-based GIN size heuristic

pub mod commands;
pub mod hypopg;
pub mod miner;
pub mod op_class;
pub mod size_estimate;
pub mod types;
