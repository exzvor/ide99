use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Locale → API host. Russian UI hits ide99.ru, everything else ide99.io.
fn endpoint(locale: &str) -> &'static str {
    if locale.starts_with("ru") {
        "https://ide99.ru/api/feedback"
    } else {
        "https://ide99.io/api/feedback"
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub filename: String,
    pub content_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackRequest<'a> {
    email: &'a str,
    message: &'a str,
    lang: &'a str,
    source: &'a str,
    app_version: &'a str,
    screenshots: &'a [Screenshot],
}

#[derive(Debug, Error)]
pub enum SupportError {
    #[error("network: {0}")]
    Network(String),
    #[error("server {status}: {body}")]
    Server { status: u16, body: String },
    #[error("decode: {0}")]
    Decode(String),
}

fn build_client() -> Result<reqwest::Client, SupportError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(8))
        .user_agent(concat!("ide99/", env!("CARGO_PKG_VERSION"), " support"))
        .build()
        .map_err(|e| SupportError::Network(format!("build client: {e}")))
}

pub async fn send_feedback(    locale: &str,
    email: &str,
    message: &str,
    screenshots: &[Screenshot],
) -> Result<(), SupportError> {
    let lang = if locale.starts_with("ru") { "ru" } else { "en" };
    let body = FeedbackRequest {
        email,
        message,
        lang,
        source: "ide99-shell",
        app_version: env!("CARGO_PKG_VERSION"),
        screenshots,
    };

    let client = build_client()?;
    let url = endpoint(locale);
    let response = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| SupportError::Network(format!("post: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response
            .text()
            .await
            .unwrap_or_else(|_| "<empty>".to_string());
        return Err(SupportError::Server {
            status: status.as_u16(),
            body: body_text,
        });
    }

    // Body is `{ ok: true }`; we don't surface anything from it, but we
    // still want a non-fatal decode pass so a server-side change to the
    // response shape shows up in tracing rather than silently passing.
    if let Err(e) = response.json::<serde_json::Value>().await {
        tracing::warn!(error = %e, "support: response body was not valid JSON");
    }
    Ok(())
}
