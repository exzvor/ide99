//! ide99 — admin-side telemetry (separate from PostHog telemetry).
//!
//! Fires non-PII counter events at the ide99 Instant Beta admin endpoint
//! (`POST /telemetry/v1/events`). This is the wedge-validation pipe — its
//! schema is intentionally different from `crate::telemetry`, which sinks
//! to PostHog. Two pipes, two policies.
//!
//! Privacy: events only fly when the user has telemetryEnabled=true in
//! the app settings (the same flag PostHog telemetry honours). Sender is
//! fire-and-forget; failures are logged at WARN and never propagated.

pub mod client;
pub mod commands;
