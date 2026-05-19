//! Connection Manager — ide99 .
//!
//! Public surface: `commands::*` are the Tauri command handlers, `types::*`
//! are the DTOs serialized over IPC. Internal modules `store`, `keychain`,
//! `pool` are implementation details consumed via `AppState` (`crate::lib`).

pub mod commands;
pub mod keychain;
pub mod pool;
pub mod store;
pub mod types;

pub use keychain::Keychain;
pub use pool::PoolRegistry;
pub use store::Store;
pub use types::{
    Connection, ConnectionError, NewConnection, ParsedUri, SslMode, TestInput, TestResult,
    UpdateConnection, UpdatePassword,
};
