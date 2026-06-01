//! Tauri command surface for the auto-updater.
//!
//! Phase E  wiring on top of the plugin:
//!
//! * `updater_check` — calls `app.updater()?.check().await?` and projects
//! the plugin's `Update` into our `CheckResult` shape (so the UI can
//! read a stable, channel-aware DTO instead of the raw plugin shape).
//! If the plugin returns `None`, we emit `UpToDate`. Plugin errors
//! funnel into `CheckResult::Error` so the UI can render them inline
//! (the IPC layer never sees a `Result::Err` for a plain "manifest
//! unreachable" — that's a banner, not a crash).
//!
//! * `updater_install_pending` — re-runs `check()` (fresh manifest, no
//! stale state across the IPC boundary) and, if an update is still
//! announced, calls `download_and_install`. Progress is emitted on
//! `updater:progress` so the renderer can drive a progress bar.
//! **No automatic install:** this command is invoked only on Approve.
//!
//! The actual signing-key / endpoint config lives in
//! `tauri.conf.json :: plugins.updater`; our pubkey there is a
//! placeholder until the release
//! script substitutes the real ed25519 key. Until that happens the plugin
//! is `active = false` and `updater_check` falls back to the
//! `manifest_unreachable` branch — which is exactly the UX we want for
//! pre-1.0 dev builds.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

use crate::updater::manifest;
use crate::updater::types::{
    CheckResult, PlatformAsset, ReleaseChannel, UpdateManifest, UpdaterError,
};
use crate::AppState;

/// Wall-clock cap for a single `check()` round-trip. The Tauri plugin has
/// no hard default, so we set our own to keep the UI responsive on flaky
/// networks. Five seconds is enough for CDN-served JSON; install download
/// uses its own (longer) inner budget.
const CHECK_TIMEOUT: Duration = Duration::from_secs(8);

/// Channel name used for `updater:progress` events. Centralised so the
/// renderer and the backend stay in lockstep.
const PROGRESS_CHANNEL: &str = "updater:progress";

#[tauri::command]
pub async fn updater_current_version() -> Result<String, UpdaterError> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
pub async fn updater_manifest_url(channel: ReleaseChannel) -> Result<String, UpdaterError> {
    Ok(manifest::manifest_url(channel))
}

#[tauri::command]
pub async fn updater_check(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<CheckResult, UpdaterError> {
    state.updater_check(&app).await
}

#[tauri::command]
pub async fn updater_install_pending(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), UpdaterError> {
    state.updater_install_pending(&app).await
}

/// Progress event payload. Snake-case for the wire to mirror our other
/// `*:progress` channels (migrations, backup) — frontend `listen()`
/// helpers expect that shape.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    phase: &'static str,
    bytes_downloaded: u64,
    bytes_total: Option<u64>,
}

impl AppState {
    pub async fn updater_check(&self, app: &AppHandle) -> Result<CheckResult, UpdaterError> {
        let channel = self.read_release_channel().await?;
        let now = Utc::now().to_rfc3339();
        let current_version = env!("CARGO_PKG_VERSION").to_string();

        // Build the updater handle. If the plugin isn't fully configured
        // (e.g. dev build with `active = false`), surface that as a soft
        // Error rather than a hard `Err` — the UI should render a banner.
        let updater = match app.updater_builder().timeout(CHECK_TIMEOUT).build() {
            Ok(u) => u,
            Err(e) => {
                // Builder failure = updater not configured / no endpoints.
                // Keep the raw error in the log; the UI keys off `code`.
                tracing::warn!(error = %e, "updater build failed");
                return Ok(CheckResult::Error {
                    code: "unavailable".into(),
                    message: format!("updater unavailable: {e}"),
                    channel,
                    checked_at: now,
                });
            }
        };

        match updater.check().await {
            Ok(None) => Ok(CheckResult::UpToDate {
                current_version,
                channel,
                checked_at: now,
            }),
            Ok(Some(update)) => {
                let manifest = project_update_to_manifest(&update);
                Ok(CheckResult::Available {
                    current_version,
                    manifest,
                    channel,
                    checked_at: now,
                })
            }
            // Any check() failure (DNS/connect/transport, or no valid release
            // JSON) means we could not reach a usable update server. Classify
            // by the failed operation rather than sniffing the error's Display
            // string, which is platform/locale/plugin-version dependent.
            Err(e) => {
                tracing::warn!(error = %e, "updater check failed");
                Ok(CheckResult::Error {
                    code: "unreachable".into(),
                    message: format!("{e}"),
                    channel,
                    checked_at: now,
                })
            }
        }
    }

    pub async fn updater_install_pending(&self, app: &AppHandle) -> Result<(), UpdaterError> {
        let updater = app
            .updater_builder()
            .timeout(CHECK_TIMEOUT)
            .build()
            .map_err(|e| UpdaterError::Install(format!("updater handle: {e}")))?;

        let update = updater
            .check()
            .await
            .map_err(|e| UpdaterError::Network(format!("{e}")))?
            .ok_or_else(|| {
                UpdaterError::Install(
                    "no pending update — re-check before requesting install".into(),
                )
            })?;

        // Emit a started event before the first chunk lands so the UI can
        // flip its progress bar immediately (the Tauri plugin's own
        // download() callback only fires per-chunk).
        let _ = app.emit(
            PROGRESS_CHANNEL,
            ProgressEvent {
                phase: "started",
                bytes_downloaded: 0,
                bytes_total: None,
            },
        );

        let mut downloaded: u64 = 0;
        let app_for_chunks = app.clone();
        let app_for_finish = app.clone();
        update
            .download_and_install(
                move |chunk_len, total| {
                    downloaded = downloaded.saturating_add(chunk_len as u64);
                    let _ = app_for_chunks.emit(
                        PROGRESS_CHANNEL,
                        ProgressEvent {
                            phase: "downloading",
                            bytes_downloaded: downloaded,
                            bytes_total: total,
                        },
                    );
                },
                move || {
                    let _ = app_for_finish.emit(
                        PROGRESS_CHANNEL,
                        ProgressEvent {
                            phase: "installing",
                            bytes_downloaded: 0,
                            bytes_total: None,
                        },
                    );
                },
            )
            .await
            .map_err(|e| UpdaterError::Install(format!("{e}")))?;

        let _ = app.emit(
            PROGRESS_CHANNEL,
            ProgressEvent {
                phase: "done",
                bytes_downloaded: 0,
                bytes_total: None,
            },
        );
        Ok(())
    }

    async fn read_release_channel(&self) -> Result<ReleaseChannel, UpdaterError> {
        let app_settings = {
            // Drop the store guard ASAP — read is synchronous and any
            // .await downstream while holding it can deadlock concurrent
            // callers (significant_drop_tightening lint).
            let store = self.store.lock().await;
            crate::telemetry::store::read(store.conn())
                .map_err(|e| UpdaterError::Storage(e.to_string()))?
        };
        Ok(ReleaseChannel::from_str_lossy(
            &app_settings.release_channel,
        ))
    }
}

/// Project the plugin's `Update` into our flat manifest DTO. Notes go
/// through the body field; signature/url default to the resolved download
/// (single-platform Tauri response) so the renderer can show a consistent
/// "what you'll get" preview.
fn project_update_to_manifest(update: &tauri_plugin_updater::Update) -> UpdateManifest {
    let mut platforms = BTreeMap::new();
    platforms.insert(
        update.target.clone(),
        PlatformAsset {
            signature: update.signature.clone(),
            url: update.download_url.to_string(),
        },
    );
    UpdateManifest {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        // `update.date` is a `time::OffsetDateTime`; rather than pulling
        // the `time` crate into our deps (it's transitively present via
        // the plugin), serialize through serde_json which has a native
        // OffsetDateTime impl when the upstream feature is enabled.
        // Falling back to Display is robust and produces the canonical
        // RFC3339 format `time` outputs by default.
        pub_date: update.date.map(|d| d.to_string()).unwrap_or_default(),
        platforms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_event_round_trips_to_camel_case() {
        let evt = ProgressEvent {
            phase: "downloading",
            bytes_downloaded: 4096,
            bytes_total: Some(102_400),
        };
        let json = serde_json::to_value(evt).unwrap();
        // Wire shape — snake-case on the Rust struct, camelCase on the wire.
        assert_eq!(json["phase"], "downloading");
        assert_eq!(json["bytesDownloaded"], 4096);
        assert_eq!(json["bytesTotal"], 102_400);
    }

    #[test]
    fn check_timeout_is_under_ten_seconds() {
        // The acceptance criterion is "5–10s". Anything past 10s reads as
        // unresponsive in user testing, so it stays well below.
        assert!(CHECK_TIMEOUT < Duration::from_secs(10));
    }

    #[test]
    fn progress_channel_name_stable() {
        // Frontend `listen("updater:progress", …)` is hardcoded; the
        // backend constant is the single source of truth.
        assert_eq!(PROGRESS_CHANNEL, "updater:progress");
    }
}
