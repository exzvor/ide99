//! Sprint 36 — telemetry HTTP round-trip против wiremock.
//!
//! Цель: убедиться, что `client::post_event` посылает корректный
//! PostHog-shape envelope в `/capture/`, а `crash::post_envelope` —
//! Sentry envelope с двумя header-строками + payload.
//!
//! Mirror pattern of `tests/mcp_transport_integration.rs`: spin up a mock
//! HTTP server, exercise the public API, assert request shape — нет реального
//! network I/O, нет real PostHog/Sentry instances.
//!
//! **Privacy invariants checked here**:
//!   * `api_key` exists in body (env-injected) — never logged
//!   * `distinct_id` matches `device_uuid`
//!   * `properties` are the sanitized BTreeMap (no banned keys)

use std::collections::BTreeMap;

use ide99::telemetry::client::{build_event, post_event, send_event};
use ide99::telemetry::crash::{build_report, post_envelope};
use ide99::telemetry::types::{AppSettings, TelemetryEndpoint, TelemetryError};
use serde_json::Value;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn opted_in_settings() -> AppSettings {
    AppSettings {
        telemetry_enabled: true,
        crash_reports_enabled: true,
        telemetry_endpoint: TelemetryEndpoint::Eu,
        device_uuid: Some("11111111-2222-3333-4444-555555555555".into()),
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

#[tokio::test]
async fn post_event_hits_capture_endpoint_with_expected_shape() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/capture/"))
        .respond_with(ResponseTemplate::new(200).set_body_string("ok"))
        .expect(1)
        .mount(&server)
        .await;

    let settings = opted_in_settings();
    let mut props = BTreeMap::new();
    props.insert("feature_id".into(), "explain".into());
    // Banned keys must be stripped by build_event.
    props.insert("query_text".into(), "SELECT 1".into());
    let event = build_event(
        "feature_used",
        settings.device_uuid.as_deref().unwrap(),
        props,
    )
    .expect("build event");

    post_event(&server.uri(), "phc_test_key", &event)
        .await
        .expect("post_event must succeed against wiremock");

    // Assert via received_requests (wiremock's request log).
    let received = server.received_requests().await.unwrap();
    assert_eq!(received.len(), 1);
    let body: Value = serde_json::from_slice(&received[0].body).unwrap();
    assert_eq!(body["api_key"], "phc_test_key");
    assert_eq!(body["event"], "feature_used");
    assert_eq!(body["distinct_id"], "11111111-2222-3333-4444-555555555555");
    assert!(body["timestamp"].is_string());
    assert_eq!(body["properties"]["feature_id"], "explain");
    assert!(
        body["properties"].get("query_text").is_none(),
        "banned key must not survive sanitization"
    );
}

#[tokio::test]
async fn send_event_noop_when_telemetry_disabled() {
    // No mock server fired — wiremock is not started, so any HTTP call would
    // fail. The test passes iff `send_event` returns early без socket open.
    let mut settings = opted_in_settings();
    settings.telemetry_enabled = false;
    let event = build_event(
        "app_launched",
        settings.device_uuid.as_deref().unwrap(),
        BTreeMap::new(),
    )
    .unwrap();
    let err = send_event(&settings, event)
        .await
        .expect_err("must Err NotOptedIn when disabled");
    assert!(matches!(err, TelemetryError::NotOptedIn));
}

#[tokio::test]
async fn post_envelope_hits_envelope_endpoint_with_two_headers() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/42/envelope/"))
        .and(header("content-type", "application/x-sentry-envelope"))
        .respond_with(ResponseTemplate::new(200).set_body_string(""))
        .expect(1)
        .mount(&server)
        .await;

    let report = build_report("panic in test", "frame at <home>/code/x.rs", "0.1.0");
    let endpoint = format!("{}/api/42/envelope/", server.uri());

    post_envelope(&endpoint, &report)
        .await
        .expect("envelope post succeeds");

    let received = server.received_requests().await.unwrap();
    assert_eq!(received.len(), 1);
    let body_str = String::from_utf8(received[0].body.clone()).unwrap();
    let lines: Vec<&str> = body_str.split('\n').collect();
    assert!(
        lines.len() >= 3,
        "envelope must be 3 lines: envelope_header, item_header, payload"
    );

    let env_header: Value = serde_json::from_str(lines[0]).unwrap();
    assert!(env_header["event_id"].is_string());
    assert!(env_header["sent_at"].is_string());

    let item_header: Value = serde_json::from_str(lines[1]).unwrap();
    assert_eq!(item_header["type"], "event");

    let item_payload: Value = serde_json::from_str(lines[2]).unwrap();
    assert_eq!(item_payload["release"], "0.1.0");
    assert_eq!(item_payload["level"], "error");
    assert_eq!(item_payload["message"]["formatted"], "panic in test");
    // Privacy: ensure no $HOME-style path leaked through.
    assert!(!body_str.contains("/Users/"));
    assert!(!body_str.contains("\\Users\\"));
}

#[tokio::test]
async fn post_event_returns_network_err_on_5xx() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/capture/"))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&server)
        .await;

    let settings = opted_in_settings();
    let event = build_event(
        "app_launched",
        settings.device_uuid.as_deref().unwrap(),
        BTreeMap::new(),
    )
    .unwrap();

    let err = post_event(&server.uri(), "k", &event)
        .await
        .expect_err("503 must surface as Network err");
    assert!(matches!(err, TelemetryError::Network(_)));
}
