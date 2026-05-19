//! Notebook Mode (Jupyter-style for SQL).
//!
//! A notebook is an ordered list of cells (SQL / Markdown / Result).
//! Contents auto-save to the `SQLite` `notebooks` table (see migration
//! 013) and can be explicitly exported or imported as a `.ide99nb` JSON
//! file.
//!
//! Run-cell reuses the existing `query::commands::query_execute` via
//! the frontend — the backend only provides persistence, file I/O and
//! a pure CTE composition helper. This keeps the module small and
//! avoids duplicating the query pipeline.

pub mod commands;
pub mod cte;
pub mod file_io;
pub mod markdown;
pub mod store;
pub mod types;
