//! Live smoke against the Phase-4 admin ingestion endpoint.
//!
//! Verifies that the Phase-5 telemetry pipe actually hits the wire and the
//! admin service accepts the schema. Run with:
//!     cargo test --test admin_telemetry_smoke -- --ignored --nocapture

use ide99::admin_telemetry::client;
use serde_json::json;
use tempfile::TempDir;

#[tokio::test(flavor = "current_thread")]
#[ignore]
async fn emit_ide_opened_and_heartbeat() {
    let tmp = TempDir::new().expect("tempdir");

    // First call provisions a device_id on disk; both events should share it.
    client::emit(
        tmp.path(),
        "ru-RU",
        "ide.opened",
        json!({ "first_run": true, "smoke": true }),
    )
    .await;

    client::emit(
        tmp.path(),
        "ru-RU",
        "ide.heartbeat",
        json!({ "seconds": 60, "smoke": true }),
    )
    .await;

    // No assertion: emit is fire-and-forget. We're proving "doesn't panic
    // and doesn't error" against the live backend. Real verification is
    // done via the admin dashboard / `GET /admin/api/events`.
    println!("admin_telemetry smoke: 2 events emitted (verify via admin /api/events)");
}
