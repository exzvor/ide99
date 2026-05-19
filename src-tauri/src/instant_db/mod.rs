//! ide99 — Instant DB (free beta) integration.
//!
//! Backend for the "Spin up a test DB" button: a one-shot Tauri command
//! that talks to the ide99 Instant Beta control service running in
//! Yandex Cloud, signs the request with a baked-in HMAC, and returns a
//! ready-to-use connection string.
//!
//! Phase 2 contract: no payment, no template choice, no persistent
//! state on the IDE side beyond a stable device-id used for per-device
//! quota on the server. TTL is server-controlled (default 1h); the
//! frontend may extend it via `instant_db_heartbeat`.

pub mod client;
pub mod commands;
pub mod config;
