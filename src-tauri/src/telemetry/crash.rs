//! Sentry-compatible crash report builder + opt-in send gate.
//!
//! Crash reports are NEVER auto-sent. Frontend receives the `CrashReport`
//! payload via `crash_capture` IPC, shows preview modal with stack + system
//! info, and only on user "Approve" hits `crash_send`.
//!
//! wires a real Sentry envelope HTTP POST. Three layers:
//! * [`build_report`] — sanitize message + stack (path redaction).
//! * [`send`] — public surface; honors opt-in + env-var guard.
//! * [`post_envelope`] — low-level Sentry envelope POST (also used by
//! the integration test against wiremock).
//!
//! **Privacy**: paths are redacted in `build_report`; we never log the
//! envelope body or DSN. Only host + status code at debug.

#![allow(    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::doc_markdown
)]

use std::time::Duration;

use chrono::Utc;
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::telemetry::types::{AppSettings, CrashReport, TelemetryError};

/// Env var supplying the Sentry DSN. If unset/empty, `send` no-ops silently
/// (defence-in-depth — no DSN means no envelope can be addressed anywhere).
const DSN_ENV: &str = "IDE99_SENTRY_DSN";

/// Hard ceiling on outbound crash latency.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Build a sanitized crash report from raw error info. Strips paths that
/// look like `/Users/<name>/...` to `<home>/...` (privacy).
#[must_use]
pub fn build_report(message: &str, stack: &str, app_version: &str) -> CrashReport {
    CrashReport {
        message: redact_paths(message),
        stack: redact_paths(stack),
        platform: detect_platform(),
        app_version: app_version.to_string(),
        captured_at: Utc::now().to_rfc3339(),
    }
}

/// Conservative path redactor — replaces `/Users/<name>/` and
/// `/home/<name>/` and `C:\Users\<name>\` with `<home>/` so crash reports
/// don't leak the developer's username.
fn redact_paths(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let bytes = text.as_bytes();
    while i < bytes.len() {
        // Try /Users/<x>/ and /home/<x>/
        for prefix in &["/Users/", "/home/"] {
            if text[i..].starts_with(prefix) {
                let after = &text[i + prefix.len()..];
                if let Some(slash) = after.find('/') {
                    out.push_str("<home>/");
                    i += prefix.len() + slash + 1;
                    break;
                }
            }
        }
        // Try C:\Users\<x>\
        if text[i..].starts_with("C:\\Users\\") {
            let after = &text[i + "C:\\Users\\".len()..];
            if let Some(bs) = after.find('\\') {
                out.push_str("<home>\\");
                i += "C:\\Users\\".len() + bs + 1;
                continue;
            }
        }
        if let Some(c) = text[i..].chars().next() {
            out.push(c);
            i += c.len_utf8();
        } else {
            break;
        }
    }
    out
}

#[must_use]
pub fn detect_platform() -> String {
    format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Envelope item header (Sentry envelope v1).
#[derive(Debug, Serialize)]
struct EnvelopeHeader<'a> {
    event_id: &'a str,
    sent_at: &'a str,
}

#[derive(Debug, Serialize)]
struct ItemHeader<'a> {
    #[serde(rename = "type")]
    ty: &'a str,
}

/// Public send entrypoint. Mirrors `client::send_event` opt-in gate.
/// Silent Ok when DSN env var is missing — no socket opens.
pub async fn send(settings: &AppSettings, report: CrashReport) -> Result<(), TelemetryError> {
    if !settings.crash_reports_enabled {
        return Err(TelemetryError::NotOptedIn);
    }
    let dsn = match std::env::var(DSN_ENV) {
        Ok(v) if !v.is_empty() => v,
        _ => {
            tracing::debug!("sentry dsn not configured; skipping crash send");
            return Ok(());
        }
    };
    let endpoint = derive_envelope_url(&dsn).ok_or_else(|| {
        // We do NOT echo the DSN back in the error string — it would defeat
        // the privacy guarantee.
        TelemetryError::InvalidInput("invalid sentry dsn".into())
    })?;
    post_envelope(&endpoint, &report).await
}

/// Convert a Sentry DSN (`https://<key>@host/<project>`) into the envelope
/// endpoint URL (`https://host/api/<project>/envelope/`). Returns `None`
/// for malformed input.
fn derive_envelope_url(dsn: &str) -> Option<String> {
    // DSN format: scheme://public_key@host[:port]/project_id
    // We strip the public_key (it goes in the X-Sentry-Auth header normally,
    // but for self-hosted ingest behind a token-less endpoint we just need
    // the URL shape). For our self-hosted Sentry with `IDE99_SENTRY_DSN`,
    // operators may also pass the envelope URL directly as DSN — we accept
    // both forms.
    if dsn.starts_with("https://") || dsn.starts_with("http://") {
        // Already an explicit URL?
        if dsn.contains("/api/") && dsn.contains("/envelope") {
            return Some(dsn.trim_end_matches('/').to_string());
        }
        // Parse classic DSN.
        let scheme_end = dsn.find("://")?;
        let scheme = &dsn[..scheme_end];
        let rest = &dsn[scheme_end + 3..];
        let (auth_host, project) = rest.split_once('/')?;
        let host = auth_host.split_once('@').map_or(auth_host, |(_k, h)| h);
        if host.is_empty() || project.is_empty() {
            return None;
        }
        // Strip any extra path on `project` — only the first segment is the
        // project ID.
        let project_id = project.split('/').next().unwrap_or(project);
        return Some(format!("{scheme}://{host}/api/{project_id}/envelope/"));
    }
    None
}

/// Low-level envelope POST. Pulled out so the integration test can target
/// wiremock without patching env vars.
///
/// Privacy: NEVER logs the body. Only host + status code at debug.
pub async fn post_envelope(endpoint: &str, report: &CrashReport) -> Result<(), TelemetryError> {
    let event_id = Uuid::new_v4().simple().to_string();
    let sent_at = Utc::now().to_rfc3339();
    let envelope_header = EnvelopeHeader {
        event_id: &event_id,
        sent_at: &sent_at,
    };
    let item_header = ItemHeader { ty: "event" };

    // Sentry event payload — minimal shape that Sentry accepts.
    let item_payload = json!({
        "event_id": event_id,
        "timestamp": report.captured_at,
        "platform": "native",
        "level": "error",
        "release": report.app_version,
        "message": { "formatted": report.message },
        "contexts": {
            "os": { "name": report.platform }
        },
        "exception": {
            "values": [{
                "type": "panic",
                "value": report.message,
                "stacktrace": { "frames": [] }
            }]
        },
        "extra": { "stack_text": report.stack }
    });

    let mut body = String::new();
    body.push_str(        &serde_json::to_string(&envelope_header)
            .map_err(|e| TelemetryError::Network(format!("envelope header: {e}")))?,
);
    body.push('\n');
    body.push_str(        &serde_json::to_string(&item_header)
            .map_err(|e| TelemetryError::Network(format!("item header: {e}")))?,
);
    body.push('\n');
    body.push_str(&item_payload.to_string());

    let host = host_only(endpoint);
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| TelemetryError::Network(format!("client build: {e}")))?;

    let resp = client
        .post(endpoint)
        .header(            reqwest::header::CONTENT_TYPE,
            "application/x-sentry-envelope",
)
        .body(body)
        .send()
        .await
        .map_err(|e| TelemetryError::Network(format!("post: {e}")))?;

    let status = resp.status();
    tracing::debug!(        host = %host,
        status = status.as_u16(),
        "sentry envelope posted"
);
    if !status.is_success() {
        return Err(TelemetryError::Network(format!(            "non-success status: {}",
            status.as_u16()
)));
    }
    Ok(())
}

fn host_only(url: &str) -> String {
    let stripped = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    stripped.split('/').next().unwrap_or("unknown").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::types::TelemetryEndpoint;

    fn opted_in() -> AppSettings {
        AppSettings {
            telemetry_enabled: false,
            crash_reports_enabled: true,
            telemetry_endpoint: TelemetryEndpoint::Eu,
            device_uuid: None,
            onboarding_completed: true,
            privacy_choice_made: true,
            privacy_choice_made_at: None,
            release_channel: "stable".into(),
            last_update_check_at: None,
            spg99_subscribed: false,
            vibepg_subscribed: false,
            created_at: "2026-05-07T00:00:00Z".into(),
            updated_at: "2026-05-07T00:00:00Z".into(),
        }
    }

    #[test]
    fn build_report_redacts_unix_home() {
        let report = build_report(            "panic at /Users/alice/code/ide99/src/lib.rs:42",
            "stack frame /Users/alice/code/x.rs",
            "1.0.0",
);
        assert!(!report.message.contains("alice"));
        assert!(report.message.contains("<home>/code"));
        assert!(!report.stack.contains("alice"));
    }

    #[test]
    fn build_report_redacts_windows_home() {
        let report = build_report("panic at C:\\Users\\bob\\AppData\\foo.dll", "", "1.0.0");
        assert!(!report.message.contains("bob"));
        assert!(report.message.contains("<home>"));
    }

    #[test]
    fn build_report_keeps_safe_text() {
        let report = build_report("regular error", "regular stack", "1.0.0");
        assert_eq!(report.message, "regular error");
        assert_eq!(report.stack, "regular stack");
    }

    #[tokio::test]
    async fn send_noop_when_disabled() {
        let mut s = opted_in();
        s.crash_reports_enabled = false;
        let report = build_report("x", "", "1.0.0");
        assert!(matches!(            send(&s, report).await,
            Err(TelemetryError::NotOptedIn)
));
    }

    /// when DSN env var is absent, `send` returns `Ok(())` silently
    /// without opening a socket. Test relies on the env var being unset in CI.
    #[tokio::test]
    async fn send_noop_when_dsn_missing() {
        if std::env::var(DSN_ENV).is_ok() {
            return; // skip if operator set a real DSN
        }
        let s = opted_in();
        let report = build_report("x", "", "1.0.0");
        send(&s, report).await.expect("missing dsn => silent Ok");
    }

    #[test]
    fn detect_platform_format_is_two_tokens() {
        let p = detect_platform();
        assert!(p.contains(' '));
    }

    #[test]
    fn derive_envelope_url_classic_dsn() {
        let dsn = "https://abc123@sentry.ide99.io/42";
        assert_eq!(            derive_envelope_url(dsn),
            Some("https://sentry.ide99.io/api/42/envelope/".to_string())
);
    }

    #[test]
    fn derive_envelope_url_explicit_url_passthrough() {
        let url = "https://sentry.ide99.io/api/42/envelope/";
        assert_eq!(            derive_envelope_url(url),
            Some(url.trim_end_matches('/').to_string())
);
    }

    #[test]
    fn derive_envelope_url_rejects_garbage() {
        assert!(derive_envelope_url("not-a-url").is_none());
        assert!(derive_envelope_url("https://hostonly").is_none());
    }

    #[tokio::test]
    async fn post_envelope_unreachable_yields_network_err() {
        let report = build_report("boom", "", "1.0.0");
        let err = post_envelope("http://127.0.0.1:1/api/42/envelope/", &report)
            .await
            .expect_err("must fail");
        assert!(matches!(err, TelemetryError::Network(_)));
    }
}
