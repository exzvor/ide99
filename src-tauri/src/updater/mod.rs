//! Auto-updater wrapper around the `tauri-plugin-updater`.
//!
//! v1.0 ships only the IPC surface + manifest URL builder. The actual
//! download/install pipeline is delegated to the Tauri plugin, wired up
//! at production build time via the `plugins.updater` block in
//! tauri.conf.json (signing keys are configured there).
//!
//! Manifest hosting: `https://updates.ide99.io/<channel>/manifest.json`
//! (channels: stable / beta / nightly).
//!
//! **No automatic install.** Frontend `<UpdateChecker>` shows release
//! notes + version diff + Approve/Defer; only on Approve do we call
//! `updater_install_pending`, which delegates to the Tauri plugin.

pub mod commands;
pub mod manifest;
pub mod types;
