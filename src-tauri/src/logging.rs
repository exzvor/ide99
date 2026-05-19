//! Tracing initialization + the `log_error` Tauri command that frontend code
//! invokes when it catches an error. JSON output in release for log shippers,
//! human-readable in debug for local dev.

use tracing_subscriber::EnvFilter;

/// Initialize the global tracing subscriber. Reads `IDE99_LOG` env var as a
/// `tracing` directives string; falls back to `info`. In debug builds we use
/// the pretty (default) formatter; in release we emit one JSON object per
/// line, suitable for downstream log shippers / Sentry (S36).
pub fn init_tracing() {
    let filter = EnvFilter::try_from_env("IDE99_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false);
    if cfg!(debug_assertions) {
        builder.init();
    } else {
        builder.json().init();
    }
}

/// Frontend bridge: write a frontend-side error into the Rust tracing pipeline.
/// Invoked from `src/lib/logger.ts` via `invoke("log_error", { message, detail })`.
#[tauri::command]
pub async fn log_error(message: String, detail: String) {
    tracing::error!(detail = %detail, "frontend error: {}", message);
}
