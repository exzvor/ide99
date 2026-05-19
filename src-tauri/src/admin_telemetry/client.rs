use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::instant_db::client::ensure_device_id;
use crate::instant_db::config;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Serialize)]
struct EventBody<'a> {
    event_name: &'a str,
    source: &'a str,
    device_id: &'a str,
    app_version: &'a str,
    locale: &'a str,
    platform: &'a str,
    payload: Value,
}

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(3))
        .user_agent(concat!(            "ide99/",
            env!("CARGO_PKG_VERSION"),
            " admin-telemetry"
))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn platform_label() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "darwin-arm64"
        } else {
            "darwin-x64"
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            "linux-arm64"
        } else {
            "linux-x64"
        }
    } else if cfg!(target_os = "windows") {
        "windows-x64"
    } else {
        "unknown"
    }
}

/// Fire-and-forget POST to admin ingestion. Tries each endpoint candidate
/// in priority order. Any failure is logged at WARN — never bubbled.
pub async fn emit(data_dir: &Path, locale: &str, event_name: &str, payload: Value) {
    let device_id = match ensure_device_id(data_dir) {
        Ok(id) => id,
        Err(e) => {
            tracing::warn!(error = %e, "admin_telemetry: device id unavailable; dropping event");
            return;
        }
    };

    let body = EventBody {
        event_name,
        source: "ide",
        device_id: &device_id,
        app_version: APP_VERSION,
        locale,
        platform: platform_label(),
        payload,
    };

    let client = build_client();
    let mut last_err: Option<String> = None;
    for base in config::endpoint_candidates(locale) {
        let url = format!("{base}/telemetry/v1/events");
        match client.post(&url).json(&body).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    return;
                }
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                tracing::warn!(endpoint = %base, status = %status, body = %txt, event = event_name, "admin_telemetry: non-2xx");
                // Don't try further endpoints on a server reply — backend was reached.
                return;
            }
            Err(e) => {
                last_err = Some(e.to_string());
                continue;
            }
        }
    }
    if let Some(err) = last_err {
        tracing::warn!(error = %err, event = event_name, "admin_telemetry: all endpoints failed");
    }
}
