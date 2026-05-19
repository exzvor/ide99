//! Sprint 37 — auto-updater integration smoke.
//!
//! Real `tauri::App` plumbing is impossible to spin up in a unit test
//! without graphics — the updater plugin's `download_and_install` reaches
//! into the OS shell. So this suite verifies the *plumbing surface* that
//! the IPC commands rely on (manifest URL builder + release-channel read
//! path through the SQLite singleton + manifest schema round-trip).
//!
//! End-to-end "publish v1.0.1, installer flips bit" is part of the
//! release-pipeline rehearsal documented в
//! `docs/engineering/18-auto-updater.md` § "Release rehearsal".

use ide99::connection::Store;
use ide99::telemetry::store as settings_store;
use ide99::telemetry::types::TelemetryEndpoint;
use ide99::updater::manifest::{is_newer, manifest_url};
use ide99::updater::types::{
    CheckResult, PlatformAsset, ReleaseChannel, UpdateManifest, UpdaterError,
};
use std::collections::BTreeMap;
use tempfile::TempDir;

struct Fresh {
    store: Store,
    // Keep the tempdir alive for the lifetime of the test so the SQLite
    // file isn't deleted from under us.
    _tmp: TempDir,
}

fn fresh_store() -> Fresh {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("ide99.sqlite");
    let mut s = Store::open(&path).expect("open store");
    s.run_migrations().expect("migrations");
    Fresh {
        store: s,
        _tmp: tmp,
    }
}

#[test]
fn release_channel_round_trips_through_app_settings() {
    // Default after migration 015 is "stable". Flip it to "beta", read
    // back, and confirm the lossy parser hands us the right enum.
    let fresh = fresh_store();
    let store = &fresh.store;
    let mut settings = settings_store::read(store.conn()).expect("read settings");
    assert_eq!(settings.release_channel, "stable");
    assert_eq!(
        ReleaseChannel::from_str_lossy(&settings.release_channel),
        ReleaseChannel::Stable,
    );

    settings.release_channel = "beta".to_string();
    settings.telemetry_endpoint = TelemetryEndpoint::Eu;
    let saved = settings_store::write(store.conn(), settings).expect("write");
    assert_eq!(saved.release_channel, "beta");
    assert_eq!(
        ReleaseChannel::from_str_lossy(&saved.release_channel),
        ReleaseChannel::Beta,
    );

    // Reload from disk to confirm persistence (not just in-memory cache).
    let reloaded = settings_store::read(store.conn()).expect("reload");
    assert_eq!(reloaded.release_channel, "beta");
}

#[test]
fn manifest_url_is_channel_specific_and_https() {
    for channel in [
        ReleaseChannel::Stable,
        ReleaseChannel::Beta,
        ReleaseChannel::Nightly,
    ] {
        let url = manifest_url(channel);
        assert!(
            url.starts_with("https://"),
            "manifest URL must be HTTPS: {url}"
        );
        assert!(
            url.contains(channel.as_str()),
            "manifest URL must include channel name: {url}"
        );
        assert!(
            url.ends_with("/manifest.json"),
            "manifest URL must end in /manifest.json: {url}"
        );
    }
}

#[test]
fn update_manifest_serde_round_trip_matches_tauri_schema() {
    // The Tauri plugin expects this exact shape on the wire:
    //   {
    //     "version": "...",
    //     "notes": "...",
    //     "pubDate": "...",
    //     "platforms": {
    //       "darwin-aarch64": { "signature": "...", "url": "..." },
    //       ...
    //     }
    //   }
    // Confirm our DTO produces / consumes it byte-for-byte.
    let mut platforms = BTreeMap::new();
    platforms.insert(
        "darwin-aarch64".to_string(),
        PlatformAsset {
            signature: "sig-arm".into(),
            url: "https://updates.ide99.io/stable/ide99-1.0.1-arm.dmg".into(),
        },
    );
    platforms.insert(
        "windows-x86_64".to_string(),
        PlatformAsset {
            signature: "sig-win".into(),
            url: "https://updates.ide99.io/stable/ide99-1.0.1.msi".into(),
        },
    );
    let manifest = UpdateManifest {
        version: "1.0.1".into(),
        notes: "## Changelog\n- fixed crash".into(),
        pub_date: "2026-05-15T10:00:00Z".into(),
        platforms,
    };
    let json = serde_json::to_value(&manifest).expect("serialize");
    assert_eq!(json["version"], "1.0.1");
    assert_eq!(json["pubDate"], "2026-05-15T10:00:00Z");
    assert_eq!(json["platforms"]["darwin-aarch64"]["signature"], "sig-arm");

    let parsed: UpdateManifest = serde_json::from_value(json).expect("deserialize");
    assert_eq!(parsed.version, "1.0.1");
    assert_eq!(parsed.platforms.len(), 2);
}

#[test]
fn check_result_available_serializes_with_kind_tag() {
    // The wire format uses internally tagged enums so the renderer can
    // discriminate via `result.kind`.
    let mut platforms = BTreeMap::new();
    platforms.insert(
        "linux-x86_64".to_string(),
        PlatformAsset {
            signature: "s".into(),
            url: "https://updates.ide99.io/stable/x.AppImage".into(),
        },
    );
    let result = CheckResult::Available {
        current_version: "1.0.0".into(),
        manifest: UpdateManifest {
            version: "1.0.1".into(),
            notes: String::new(),
            pub_date: String::new(),
            platforms,
        },
        channel: ReleaseChannel::Stable,
        checked_at: "2026-05-07T00:00:00Z".into(),
    };
    let json = serde_json::to_value(&result).expect("serialize");
    assert_eq!(json["kind"], "available");
    assert_eq!(json["currentVersion"], "1.0.0");
    assert_eq!(json["channel"], "stable");
}

#[test]
fn updater_error_serialises_with_code_message_pair() {
    // The frontend `UpdaterError` discriminator union depends on the
    // `code` field being one of {storage_error, network_error,
    // invalid_manifest, install_failed}.
    let cases = [
        (UpdaterError::Storage("io".into()), "storage_error"),
        (UpdaterError::Network("timeout".into()), "network_error"),
        (
            UpdaterError::InvalidManifest("bad sig".into()),
            "invalid_manifest",
        ),
        (UpdaterError::Install("oops".into()), "install_failed"),
    ];
    for (err, expected_code) in cases {
        let json = serde_json::to_value(err).expect("serialize");
        assert_eq!(json["code"], expected_code);
        assert!(json["message"].is_string());
    }
}

#[test]
fn semver_compare_supports_acceptance_v100_to_v101() {
    // Acceptance criterion #3 — direct guard.
    assert!(is_newer("1.0.0", "1.0.1"));
    assert!(!is_newer("1.0.1", "1.0.0"));
}
