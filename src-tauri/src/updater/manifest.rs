//! Manifest URL builder + version compare.
//!
//! Pure helpers — Phase A. //! `tauri-plugin-updater` (avoids a second reqwest stack — the plugin
//! brings one).

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use crate::updater::types::ReleaseChannel;

/// Manifest URL for the given channel. Hardcoded host because the auto-
/// updater requires a fixed origin (signature verification ties update
/// payloads to it).
#[must_use]
pub fn manifest_url(channel: ReleaseChannel) -> String {
    format!(        "https://updates.ide99.io/{}/manifest.json",
        channel.as_str()
)
}

/// Naive semver compare for "X.Y.Z" with optional pre-release suffix
/// after `-`. Returns true if `latest > current`. Pre-release suffixes
/// are treated as STRICTLY OLDER than the same X.Y.Z without suffix
/// (Tauri convention) — we mirror it so manifest pre-releases don't
/// trigger upgrades from a stable build.
#[must_use]
pub fn is_newer(current: &str, latest: &str) -> bool {
    let (cur, cur_pre) = split_pre(current);
    let (lat, lat_pre) = split_pre(latest);
    let cur_parts = parse(cur);
    let lat_parts = parse(lat);
    if lat_parts > cur_parts {
        return true;
    }
    if lat_parts < cur_parts {
        return false;
    }
    // Equal core: pre-release < release (Tauri semantics).
    match (cur_pre, lat_pre) {
        (Some(_), None) => true,
        (None, Some(_)) => false,
        _ => false,
    }
}

fn split_pre(s: &str) -> (&str, Option<&str>) {
    s.split_once('-').map_or((s, None), |(c, p)| (c, Some(p)))
}

fn parse(s: &str) -> [u32; 3] {
    let mut out = [0u32; 3];
    for (i, p) in s.splitn(3, '.').enumerate() {
        if i >= 3 {
            break;
        }
        out[i] = p.parse().unwrap_or(0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_url_per_channel() {
        assert_eq!(            manifest_url(ReleaseChannel::Stable),
            "https://updates.ide99.io/stable/manifest.json"
);
        assert_eq!(            manifest_url(ReleaseChannel::Beta),
            "https://updates.ide99.io/beta/manifest.json"
);
        assert_eq!(            manifest_url(ReleaseChannel::Nightly),
            "https://updates.ide99.io/nightly/manifest.json"
);
    }

    #[test]
    fn newer_minor_bump() {
        assert!(is_newer("1.0.0", "1.1.0"));
        assert!(is_newer("1.0.0", "1.0.1"));
        assert!(is_newer("1.0.0", "2.0.0"));
    }

    #[test]
    fn equal_versions_are_not_newer() {
        assert!(!is_newer("1.0.0", "1.0.0"));
    }

    #[test]
    fn older_versions_are_not_newer() {
        assert!(!is_newer("1.1.0", "1.0.5"));
        assert!(!is_newer("2.0.0", "1.99.99"));
    }

    #[test]
    fn pre_release_is_older_than_release() {
        assert!(is_newer("1.0.0-rc1", "1.0.0"));
        assert!(!is_newer("1.0.0", "1.0.0-rc1"));
    }

    #[test]
    fn malformed_versions_handled_gracefully() {
        // Parse failure → 0; comparison still works deterministically.
        assert!(!is_newer("garbage", "garbage"));
    }

    #[test]
    fn pre_release_to_pre_release_compares_by_core_only() {
        // Pre-release suffixes don't yet drive ordering — same core
        // numbers, both pre-release → not newer (Phase E behaviour).
        assert!(!is_newer("1.0.0-rc1", "1.0.0-rc2"));
        // Higher core wins regardless of suffix shape.
        assert!(is_newer("1.0.0-rc1", "1.0.1-rc1"));
    }

    #[test]
    fn s37_acceptance_v100_to_v101() {
        // Acceptance criterion #3 — install v1.0.0 → publish v1.0.1
        // → ide99 detects. Direct guard so we don't regress this path.
        assert!(is_newer("1.0.0", "1.0.1"));
    }
}
