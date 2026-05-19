//! Telemetry event allowlist + props sanitizer.
//!
//! **Why allowlist**: query/schema/data telemetry is forbidden. An
//! open-ended event-name surface would let a future contributor
//! accidentally introduce one. The allowlist is small, reviewable, and
//! enforced by `is_known_event`.
//!
//! **Why sanitize**: same reason — `props` keys could leak query/schema
//! identifiers. `sanitize_props` strips any key that matches an unsafe
//! pattern (long values, suspicious key names) before send.

use std::collections::BTreeMap;

/// Allowlisted event names. Each event is a counter (no payload value) —
/// PostHog `properties` carry only categorical data: feature ID, mode,
/// connection environment label, etc.
const KNOWN_EVENTS: &[&str] = &[
    // Lifecycle
    "app_launched",
    "session_ended",
    // Feature usage
    "feature_used",
    "tab_opened",
    "query_executed",
    "explain_opened",
    "health_check_run",
    "live_ops_opened",
    "erd_opened",
    "object_editor_opened",
    "migration_applied",
    "notebook_created",
    "backup_started",
    "restore_started",
    // Mode + theme + language
    "mode_switched",
    "theme_switched",
    "language_switched",
    // Onboarding
    "onboarding_started",
    "onboarding_completed",
    // MCP
    "mcp_server_enabled",
    "mcp_client_connected",
    // Privacy
    "privacy_choice_made",
];

#[must_use]
pub fn is_known_event(name: &str) -> bool {
    KNOWN_EVENTS.contains(&name)
}

#[must_use]
pub fn known_events() -> &'static [&'static str] {
    KNOWN_EVENTS
}

/// Maximum length for a single prop value. Anything longer is replaced
/// with `<truncated>` — a query string would obviously trip this;
/// categorical values pass through.
pub const MAX_PROP_VALUE_LEN: usize = 64;

/// Keys that look identifier-ish (table / column / schema / sql / query / data
/// / payload / value) — banned outright.
const BANNED_KEY_SUBSTRINGS: &[&str] = &[
    "sql",
    "query",
    "schema",
    "table",
    "column",
    "row",
    "data",
    "payload",
    "value",
    "content",
    "text",
    "json",
    "params",
    "args",
    "argv",
    "env",
    "secret",
    "password",
    "token",
    "credential",
    "ip",
    "host",
    "uri",
    "connection_string",
    "dsn",
];

/// Apply both filters: drop banned-key entries; truncate over-long values.
pub fn sanitize_props(input: BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (k, v) in input {
        let key_lower = k.to_lowercase();
        if BANNED_KEY_SUBSTRINGS.iter().any(|p| key_lower.contains(p)) {
            continue;
        }
        let v = if v.chars().count() > MAX_PROP_VALUE_LEN {
            "<truncated>".to_string()
        } else {
            v
        };
        out.insert(k, v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_events_lookup() {
        assert!(is_known_event("app_launched"));
        assert!(is_known_event("query_executed"));
        assert!(!is_known_event("custom_arbitrary_event"));
    }

    #[test]
    fn sanitize_drops_banned_keys() {
        let mut input = BTreeMap::new();
        input.insert("feature_id".into(), "explain".into());
        input.insert("query_text".into(), "SELECT * FROM users".into());
        input.insert("schema_name".into(), "public".into());
        input.insert("connection_string".into(), "postgresql://...".into());
        let out = sanitize_props(input);
        assert!(out.contains_key("feature_id"));
        assert!(!out.contains_key("query_text"));
        assert!(!out.contains_key("schema_name"));
        assert!(!out.contains_key("connection_string"));
    }

    #[test]
    fn sanitize_truncates_long_values() {
        let long = "x".repeat(200);
        let mut input = BTreeMap::new();
        input.insert("feature_id".into(), long);
        let out = sanitize_props(input);
        assert_eq!(out.get("feature_id").unwrap(), "<truncated>");
    }

    #[test]
    fn sanitize_passes_short_safe_values() {
        let mut input = BTreeMap::new();
        input.insert("env".into(), "prod".into()); // banned via "env"
        input.insert("mode".into(), "easy".into());
        input.insert("theme".into(), "dark".into());
        let out = sanitize_props(input);
        assert!(out.contains_key("mode"));
        assert!(out.contains_key("theme"));
        assert!(!out.contains_key("env"));
    }

    #[test]
    fn case_insensitive_key_match() {
        let mut input = BTreeMap::new();
        input.insert("QueryText".into(), "SELECT 1".into());
        input.insert("UserPassword".into(), "x".into());
        let out = sanitize_props(input);
        assert!(out.is_empty());
    }
}
