#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

//! — Health Screen backend.
//!
//! Ten parallel diagnostic queries against a connected Postgres database,
//! plus on-demand `SQLite` snapshot history for the 7-day `db_size` sparkline.
//!
//! Frontend invokes one `health_*` command per card; failures are
//! discriminated via `CardError` so the UI can render extension/permission/
//! generic-failure variants distinctly.

pub mod actions;
pub mod commands;
pub mod queries;
pub mod snapshots;
pub mod types;

pub use types::{
    ActiveConnectionsData, BloatRow, BloatTopData, CacheHitData, CardError, DbSizeData,
    HealthSnapshotRow, LongQueryRow, LongRunningData, MissingIndexRow, MissingIndexesData,
    ReplicationLagData, ReplicationSlotRow, ReplicationState, SlowQueriesData, SlowQueryRow,
    UnusedIndexRow, UnusedIndexesData, VacuumRow, VacuumStatusData,
};
