//! Schema introspection module — .
//!
//! Exposes 6 read-only Tauri commands that query `information_schema` /
//! `pg_catalog` for schemas, tables, views, columns, indexes, and foreign
//! keys. All commands lookup the active pool from `PoolRegistry`; if no pool
//! exists for the given `conn_id`, returns `ConnectionError::NotConnected`.

pub mod apply_ddl;
pub mod commands;
pub mod erd;
pub mod erd_queries;
pub mod erd_types;
pub mod introspect;
pub mod positions;
pub mod queries;
pub mod tgtype_decode;
pub mod types;

#[cfg(test)]
mod introspect_tests;
#[cfg(test)]
mod introspect_tests_s24;
#[cfg(test)]
mod introspect_tests_s25;

pub use types::{
    ColumnInfo, ConnectInfo, ForeignKeyInfo, IndexInfo, SchemaInfo, TableInfo, ViewInfo,
};
