//! Compile-time endpoints + HMAC secret for the Instant DB beta.
//!
//! These are NOT real auth — a baked-in client secret in a desktop binary is
//! extractable. The HMAC is an anti-spam token to keep random curl-floods off
//! the beta service. Per-user isolation is enforced server-side at the
//! postgres ACL level (REVOKE CONNECT … FROM PUBLIC + per-role GRANT).

/// Domain for builds that ship to a Russian audience.
pub const URL_RU: &str = "https://instant.ide99.ru";
/// Domain for all other locales / international builds.
pub const URL_INTL: &str = "https://instant.ide99.io";
/// Fallback used while DNS+TLS are still being provisioned. Plain HTTP on
/// port 80 of the beta VM — caddy on that port routes `/v1/instant-db/*` to
/// control and `/telemetry/v1/*` to admin, so the same fallback works for
/// both pipes. Once DNS+LE certs land, the HTTPS canonicals win first and
/// this is effectively dead code without a rebuild.
pub const URL_DEV_FALLBACK: &str = "http://46.21.247.85";

/// HMAC-SHA256 secret matching `HMAC_SECRET` in the control service `.env`.
/// Bumping this requires bumping the same secret on the VM and shipping a new
/// IDE build. Rotation cadence will be set when the beta moves out of free.
pub const HMAC_SECRET: &str = "a005cd0beb137e0a14a172fde38725abe7d5cfbb232a895e652a17667d714fd4";

/// Server-side default TTL. Mirrored here for UI hints; the server is the
/// source of truth and may overrule.
pub const DEFAULT_TTL_SECONDS: u64 = 3600;

/// Return endpoint candidates in priority order based on UI locale.
/// `ru-*` → RU domain first, else INTL first. Dev-fallback IP is always last.
pub fn endpoint_candidates(locale: &str) -> Vec<&'static str> {
    if locale.starts_with("ru") {
        vec![URL_RU, URL_INTL, URL_DEV_FALLBACK]
    } else {
        vec![URL_INTL, URL_RU, URL_DEV_FALLBACK]
    }
}
