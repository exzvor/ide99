//! Per-kind serializers / importers for the `.ide99` envelope.
//!
//! connection / connection-bundle. Phase F (): snippet,
//! snippet-bundle, query, notebook, migration-set, erd-layout, theme, keymap,
//! health-config.

pub mod connection;
pub mod erd_layout;
pub mod health_config;
pub mod keymap;
pub mod migration_set;
pub mod notebook;
pub mod query;
pub mod snippet;
pub mod theme;
