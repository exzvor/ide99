//! PostHog-compatible HTTP POST client.
//!
//! Two layers:
//! * [`send_event`] — public surface. Honors `AppSettings` opt-in gate,
//! resolves base URL from the chosen endpoint region, then delegates to
//! [`post_event`].
//! * [`post_event`] — low-level. Takes an explicit base URL (so the
//! integration test in `tests/telemetry_integration.rs` can target
//! wiremock), posts the PostHog `/capture/` envelope.
//!
//! **Hard guarantee**: `send_event` returns `Ok(())` without HTTP call when:
//! * `telemetry_enabled = false` (Err `NotOptedIn`), OR
//! * `endpoint == None` (silent Ok), OR
//! * `device_uuid is None` (Err `NotOptedIn`)
//!
//! **Privacy red line**:
//! NEVER log api_key, request body, response body, query, schema, or any
//! PII. Only `event name + host + status code` go to `tracing::debug!`.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::doc_markdown
)]

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::Utc;
use serde::Serialize;

use crate::telemetry::events;
use crate::telemetry::types::{AppSettings, TelemetryEndpoint, TelemetryError, TelemetryEvent};

/// Env var that supplies the PostHog project API key. If absent, telemetry
/// is silently no-op'd (defence-in-depth — no key, no leak).
const API_KEY_ENV: &str = "IDE99_TELEMETRY_API_KEY";

/// Hard ceiling on outbound telemetry latency. Keeps the IDE responsive
/// even if the telemetry endpoint is wedged.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// PostHog `/capture/` payload. Field names match PostHog wire protocol;
/// `properties` is a sanitized BTreeMap (see `events::sanitize_props`).
#[derive(Debug, Serialize)]
struct CapturePayload<'a> {
    api_key: &'a str,
    event: &'a str,
    distinct_id: &'a str,
    timestamp: String,
    properties: &'a BTreeMap<String, String>,
}

/// Build an event from primitive inputs. Validates the event name + sanitizes
/// props. Caller passes the current `device_uuid` from settings.
pub fn build_event(
    name: &str,
    distinct_id: &str,
    props: BTreeMap<String, String>,
) -> Result<TelemetryEvent, TelemetryError> {
    if !events::is_known_event(name) {
        return Err(TelemetryError::UnknownEvent(name.to_string()));
    }
    if distinct_id.is_empty() {
        return Err(TelemetryError::InvalidInput(
            "distinct_id must not be empty".into(),
        ));
    }
    Ok(TelemetryEvent {
        name: name.to_string(),
        distinct_id: distinct_id.to_string(),
        props: events::sanitize_props(props),
    })
}

/// Top-level send. Pure no-op when opt-in is OFF or endpoint is `None`.
///
/// Resolves base URL from `settings.telemetry_endpoint`; if API key env var
/// is unset the call still returns `Ok(())` (defence-in-depth — nothing to
/// authenticate with means nothing leaves the host).
pub async fn send_event(
    settings: &AppSettings,
    event: TelemetryEvent,
) -> Result<(), TelemetryError> {
    if !settings.telemetry_enabled {
        return Err(TelemetryError::NotOptedIn);
    }
    let Some(uuid) = settings.device_uuid.as_deref() else {
        return Err(TelemetryError::NotOptedIn);
    };
    if event.distinct_id != uuid {
        return Err(TelemetryError::InvalidInput("distinct_id mismatch".into()));
    }
    let Some(base_url) = settings.telemetry_endpoint.base_url() else {
        return Ok(()); // endpoint == None — defence-in-depth no-op
    };
    let api_key = match std::env::var(API_KEY_ENV) {
        Ok(k) if !k.is_empty() => k,
        _ => {
            // No key configured — silent no-op. Do NOT log the env var name
            // alongside any value-bearing output.
            tracing::debug!(                event = %event.name,
                            "telemetry api key not configured; skipping send"
            );
            return Ok(());
        }
    };
    post_event(base_url, &api_key, &event).await
}

/// Low-level POST helper. Pulled out so integration tests can target an
/// arbitrary base URL (wiremock) without mutating settings.
///
/// Privacy: api_key is **never** logged. Body and response body are
/// **never** logged. Only the host + status code at debug level.
pub async fn post_event(
    base_url: &str,
    api_key: &str,
    event: &TelemetryEvent,
) -> Result<(), TelemetryError> {
    let payload = CapturePayload {
        api_key,
        event: &event.name,
        distinct_id: &event.distinct_id,
        timestamp: Utc::now().to_rfc3339(),
        properties: &event.props,
    };
    let url = format!("{}/capture/", base_url.trim_end_matches('/'));
    let host = host_only(base_url);

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| TelemetryError::Network(format!("client build: {e}")))?;

    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| TelemetryError::Network(format!("post: {e}")))?;

    let status = resp.status();
    tracing::debug!(        event = %event.name,
            host = %host,
            status = status.as_u16(),
            "telemetry capture posted"
    );
    if !status.is_success() {
        return Err(TelemetryError::Network(format!(
            "non-success status: {}",
            status.as_u16()
        )));
    }
    Ok(())
}

/// Extract just the host (no scheme, no path) for safe debug logging.
fn host_only(url: &str) -> String {
    let stripped = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    stripped.split('/').next().unwrap_or("unknown").to_string()
}

/// Helper: classify endpoint+enabled into a single boolean for UI.
#[must_use]
pub fn is_active(settings: &AppSettings) -> bool {
    settings.telemetry_enabled
        && settings.device_uuid.is_some()
        && settings.telemetry_endpoint != TelemetryEndpoint::None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opted_in_settings() -> AppSettings {
        AppSettings {
            telemetry_enabled: true,
            crash_reports_enabled: false,
            telemetry_endpoint: TelemetryEndpoint::Eu,
            device_uuid: Some("00000000-0000-0000-0000-000000000001".into()),
            onboarding_completed: true,
            privacy_choice_made: true,
            privacy_choice_made_at: Some("2026-05-07T00:00:00Z".into()),
            release_channel: "stable".into(),
            last_update_check_at: None,
            spg99_subscribed: false,
            vibepg_subscribed: false,
            created_at: "2026-05-07T00:00:00Z".into(),
            updated_at: "2026-05-07T00:00:00Z".into(),
        }
    }

    #[test]
    fn build_event_validates_known_name() {
        let ev = build_event(
            "app_launched",
            "deadbeef-0000-0000-0000-000000000000",
            BTreeMap::new(),
        )
        .expect("build");
        assert_eq!(ev.name, "app_launched");
    }

    #[test]
    fn build_event_rejects_unknown_name() {
        let err = build_event("custom_event", "x", BTreeMap::new()).expect_err("must reject");
        assert!(matches!(err, TelemetryError::UnknownEvent(_)));
    }

    #[test]
    fn build_event_rejects_empty_distinct_id() {
        assert!(matches!(
            build_event("app_launched", "", BTreeMap::new()),
            Err(TelemetryError::InvalidInput(_))
        ));
    }

    #[test]
    fn build_event_sanitizes_props() {
        let mut props = BTreeMap::new();
        props.insert("feature_id".into(), "explain".into());
        props.insert("query_text".into(), "SELECT 1".into());
        let ev = build_event("feature_used", "id-1", props).unwrap();
        assert!(ev.props.contains_key("feature_id"));
        assert!(!ev.props.contains_key("query_text"));
    }

    #[tokio::test]
    async fn send_noop_when_disabled() {
        let mut s = opted_in_settings();
        s.telemetry_enabled = false;
        let ev = build_event(
            "app_launched",
            s.device_uuid.as_deref().unwrap(),
            BTreeMap::new(),
        )
        .unwrap();
        assert!(matches!(
            send_event(&s, ev).await,
            Err(TelemetryError::NotOptedIn)
        ));
    }

    #[tokio::test]
    async fn send_noop_when_endpoint_none() {
        let mut s = opted_in_settings();
        s.telemetry_endpoint = TelemetryEndpoint::None;
        let ev = build_event(
            "app_launched",
            s.device_uuid.as_deref().unwrap(),
            BTreeMap::new(),
        )
        .unwrap();
        // Endpoint=None still satisfies opt-in but short-circuits — Ok(()).
        assert!(send_event(&s, ev).await.is_ok());
    }

    /// when API key env var is absent we silently no-op (no socket
    /// open). The base URL is real (`https://telemetry.ide99.io`) — if the
    /// gate were broken the test would either panic on DNS or hang on the
    /// 5-second timeout. We rely on the env var being absent in the test env.
    #[tokio::test]
    async fn send_noop_when_api_key_missing() {
        // Make sure we're not contaminated by a parent shell var.
        // SAFETY: tests in this binary are gated to single-thread for env
        // mutation; we restrict to read-only here to avoid races with other
        // tests touching the same var.
        if std::env::var(API_KEY_ENV).is_ok() {
            // Skip: another test (or operator) configured a real key.
            return;
        }
        let s = opted_in_settings();
        let ev = build_event(
            "app_launched",
            s.device_uuid.as_deref().unwrap(),
            BTreeMap::new(),
        )
        .unwrap();
        send_event(&s, ev)
            .await
            .expect("missing api key => silent Ok");
    }

    #[tokio::test]
    async fn send_rejects_distinct_id_mismatch() {
        let s = opted_in_settings();
        // Build with a different distinct_id than settings.device_uuid.
        let ev = build_event(
            "app_launched",
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
            BTreeMap::new(),
        )
        .unwrap();
        assert!(matches!(
            send_event(&s, ev).await,
            Err(TelemetryError::InvalidInput(_))
        ));
    }

    #[test]
    fn is_active_requires_enabled_uuid_and_real_endpoint() {
        let mut s = opted_in_settings();
        assert!(is_active(&s));
        s.device_uuid = None;
        assert!(!is_active(&s));
    }

    #[test]
    fn host_only_strips_scheme_and_path() {
        assert_eq!(
            host_only("https://telemetry.ide99.io"),
            "telemetry.ide99.io"
        );
        assert_eq!(
            host_only("https://telemetry.ide99.io/capture/"),
            "telemetry.ide99.io"
        );
        assert_eq!(host_only("http://127.0.0.1:8080/x"), "127.0.0.1:8080");
    }

    /// Sanity: `post_event` against an unreachable URL fails fast — without
    /// hitting the global 5s timeout (connection refused returns immediately).
    /// Confirms the error path is `Network(_)`, never panics.
    #[tokio::test]
    async fn post_event_unreachable_yields_network_err() {
        let ev = build_event(
            "app_launched",
            "00000000-0000-0000-0000-000000000001",
            BTreeMap::new(),
        )
        .unwrap();
        // Port 1 is reserved + unbound on every CI runner we use.
        let err = post_event("http://127.0.0.1:1", "test_key", &ev)
            .await
            .expect_err("must fail");
        assert!(matches!(err, TelemetryError::Network(_)));
    }
}
