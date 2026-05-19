//! JSONB module — write path (S15) + inference path (S16) + query builder + suggester (S17).
//!
//! `write` keeps the original `query::jsonb::*` surface unchanged via
//! re-exports — every existing call site (`compute_diff`, `apply`,
//! `JsonbParam`, etc.) continues to resolve identically.

pub mod builder;
pub mod inference;
pub mod suggester;
pub mod write;

pub use write::{
    apply, build_update_sql, compute_diff, inject_ctid_column, looks_like_single_base_table,
    resolve_row_key, ColumnSource, JsonbParam, DIFF_OPS_THRESHOLD,
};
