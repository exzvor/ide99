//! Tauri commands surfaced to the renderer for the Support wedge.

use super::client::{self, Screenshot, SupportError};

fn map_err(e: SupportError) -> String {
    match e {
        SupportError::Server { status, body } => format!("server {status}: {body}"),
        other => other.to_string(),
    }
}

#[tauri::command]
pub async fn support_send_feedback(
    locale: String,
    email: String,
    message: String,
    screenshots: Vec<Screenshot>,
) -> Result<(), String> {
    client::send_feedback(&locale, &email, &message, &screenshots)
        .await
        .map_err(map_err)
}
