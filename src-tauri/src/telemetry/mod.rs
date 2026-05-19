//! Opt-in telemetry + crash reporting.
//!
//! Two independent surfaces with shared opt-in plumbing:
//! * `telemetry::client` — PostHog-compatible HTTP POST to
//!   `telemetry.ide99.io` (EU) or `telemetry.ide99.ru` (RU). Counts only,
//!   never query/schema/data.
//! * `telemetry::crash` — Sentry-compatible envelope built only when
//!   the user previews and approves a crash report.
//!
//! Both NEVER fire without explicit opt-in (`app_settings.telemetry_enabled
//! = 1` / `crash_reports_enabled = 1`).

pub mod client;
pub mod commands;
pub mod crash;
pub mod events;
pub mod store;
pub mod types;
