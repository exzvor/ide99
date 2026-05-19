//! OS keychain abstraction.
//!
//! `OsKeychain` wraps the cross-platform `keyring` crate (macOS Security,
//! Windows wincred, Linux libsecret). `MemoryKeychain` is the test/CI
//! fallback used when `IDE99_KEYCHAIN_BACKEND=memory` is set or when the OS
//! backend is missing (e.g. headless Linux without `gnome-keyring-daemon`).
//! `FsKeychain` is a filesystem-backed fallback used in debug builds (and
//! opt-in for QA via env) so passwords survive across restarts even when the
//! OS keychain ACL drops entries between dev rebuilds.

#![allow(clippy::missing_errors_doc, clippy::significant_drop_tightening)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::connection::types::ConnectionError;

const SERVICE: &str = "io.ide99.app";
const BACKEND_ENV: &str = "IDE99_KEYCHAIN_BACKEND";
const FS_FILE_NAME: &str = "connection-passwords.json";

pub trait Keychain: Send + Sync {
    fn store(&self, connection_id: &str, password: &str) -> Result<(), ConnectionError>;
    fn get(&self, connection_id: &str) -> Result<Option<String>, ConnectionError>;
    fn delete(&self, connection_id: &str) -> Result<(), ConnectionError>;
}

/// Pick a backend at startup. Priority:
/// - `IDE99_KEYCHAIN_BACKEND=memory` → `MemoryKeychain` (CI / unit tests).
/// - `IDE99_KEYCHAIN_BACKEND=os` → OS keychain only (force production behavior).
/// - `IDE99_KEYCHAIN_BACKEND=os+fs` → OS keychain layered with filesystem fallback.
/// - Otherwise: OS keychain. Filesystem fallback is layered on top in debug
/// builds so dev-mode QA doesn't lose passwords every restart when macOS
/// keychain ACLs drop between rebuilds (the user-visible symptom).
///
/// The chosen backend is wrapped in a `CachingKeychain` decorator: on macOS
/// in dev (without code-signing entitlements) the OS keychain ACL frequently
/// drops between calls within the same process — the first `get` returns the
/// password, the second returns `NoEntry`. Caching every successful read in
/// memory makes the rest of the session immune. Cache is invalidated on
/// store / delete so the layer can't leak stale values after an Edit / Delete.
#[must_use]
pub fn pick() -> Box<dyn Keychain> {
    pick_with_data_dir(crate::app_paths::data_dir().ok().as_deref())
}

/// Construction helper used by `pick()` and by tests that want to drive the
/// fallback layer at a specific path without touching the real data dir.
#[must_use]
pub fn pick_with_data_dir(data_dir: Option<&Path>) -> Box<dyn Keychain> {
    let backend = std::env::var(BACKEND_ENV).ok();

    if backend.as_deref() == Some("memory") {
        return Box::new(CachingKeychain::new(Box::new(MemoryKeychain::new())));
    }

    let primary: Box<dyn Keychain> = match OsKeychain::probe() {
        Ok(k) => Box::new(k),
        Err(err) => {
            tracing::warn!(                error = %err,
                            "OS keychain unavailable; falling back to in-memory backend"
            );
            Box::new(MemoryKeychain::new())
        }
    };

    let want_fs = match backend.as_deref() {
        Some("os") => false,
        Some("os+fs") => true,
        _ => cfg!(debug_assertions),
    };

    let inner: Box<dyn Keychain> = if want_fs {
        if let Some(dir) = data_dir {
            let fs_path = dir.join(FS_FILE_NAME);
            match FsKeychain::open(&fs_path) {
                Ok(fs) => {
                    tracing::info!(                        path = %fs_path.display(),
                                            "filesystem keychain fallback engaged (debug build / opt-in)"
                    );
                    Box::new(LayeredKeychain::new(primary, Box::new(fs)))
                }
                Err(e) => {
                    tracing::warn!(                        error = %e,
                                            path = %fs_path.display(),
                                            "FS keychain init failed; using primary backend only",
                    );
                    primary
                }
            }
        } else {
            tracing::warn!("FS keychain requested but data dir unavailable; primary only");
            primary
        }
    } else {
        primary
    };

    Box::new(CachingKeychain::new(inner))
}

pub struct OsKeychain;

impl OsKeychain {
    /// Verify the OS keyring is reachable by performing a benign read on a
    /// known-absent entry; `NoEntry` is the success signal.
    fn probe() -> Result<Self, keyring::Error> {
        let entry = keyring::Entry::new(SERVICE, "__ide99_probe__")?;
        match entry.get_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(Self),
            Err(err) => Err(err),
        }
    }

    fn entry(id: &str) -> Result<keyring::Entry, ConnectionError> {
        keyring::Entry::new(SERVICE, &format!("connection:{id}"))
            .map_err(|e| ConnectionError::Keychain(e.to_string()))
    }
}

impl Keychain for OsKeychain {
    fn store(&self, id: &str, password: &str) -> Result<(), ConnectionError> {
        Self::entry(id)?
            .set_password(password)
            .map_err(|e| ConnectionError::Keychain(e.to_string()))
    }

    fn get(&self, id: &str) -> Result<Option<String>, ConnectionError> {
        match Self::entry(id)?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(ConnectionError::Keychain(err.to_string())),
        }
    }

    /// Idempotent: missing entries are not an error so retries are safe.
    fn delete(&self, id: &str) -> Result<(), ConnectionError> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(ConnectionError::Keychain(err.to_string())),
        }
    }
}

pub struct MemoryKeychain {
    inner: Mutex<HashMap<String, String>>,
}

impl MemoryKeychain {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for MemoryKeychain {
    fn default() -> Self {
        Self::new()
    }
}

impl Keychain for MemoryKeychain {
    fn store(&self, id: &str, password: &str) -> Result<(), ConnectionError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
        g.insert(id.to_string(), password.to_string());
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Option<String>, ConnectionError> {
        let g = self
            .inner
            .lock()
            .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
        Ok(g.get(id).cloned())
    }

    fn delete(&self, id: &str) -> Result<(), ConnectionError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
        g.remove(id);
        Ok(())
    }
}

/// Filesystem-backed fallback keychain.
///
/// Stores `connection_id → password` as a JSON map at `data_dir/[FS_FILE_NAME]`.
/// On Unix the file is written with mode 0600 (user-only readable) — this is
/// the same security posture as `PostgreSQL`'s `~/.pgpass`. Engaged in debug
/// builds (and via `IDE99_KEYCHAIN_BACKEND=os+fs`) as a layered fallback so
/// dev-mode QA can keep passwords across restarts even when the OS keychain
/// ACL drops entries between rebuilds.
///
/// Intentionally not engaged in release builds: production should rely on the
/// OS keychain, which (with code-signed binaries) does not exhibit the dev-mode
/// ACL drift.
pub struct FsKeychain {
    path: PathBuf,
    inner: Mutex<HashMap<String, String>>,
}

impl FsKeychain {
    pub fn open(path: &Path) -> Result<Self, ConnectionError> {
        let inner = if path.exists() {
            let bytes = std::fs::read(path)
                .map_err(|e| ConnectionError::Keychain(format!("read {}: {e}", path.display())))?;
            if bytes.is_empty() {
                HashMap::new()
            } else {
                serde_json::from_slice::<HashMap<String, String>>(&bytes).map_err(|e| {
                    ConnectionError::Keychain(format!("parse {}: {e}", path.display()))
                })?
            }
        } else {
            HashMap::new()
        };
        Ok(Self {
            path: path.to_path_buf(),
            inner: Mutex::new(inner),
        })
    }

    /// Atomic write: serialize → write to `<path>.tmp` with 0600 → rename over
    /// the destination so a crash mid-flush can't leave a half-written file.
    fn flush(&self, map: &HashMap<String, String>) -> Result<(), ConnectionError> {
        let bytes = serde_json::to_vec(map)
            .map_err(|e| ConnectionError::Keychain(format!("serialize: {e}")))?;
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, &bytes)
            .map_err(|e| ConnectionError::Keychain(format!("write {}: {e}", tmp.display())))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            // Best-effort; ignore failures on filesystems that don't honor mode bits.
            let _ = std::fs::set_permissions(&tmp, perms);
        }
        std::fs::rename(&tmp, &self.path).map_err(|e| {
            ConnectionError::Keychain(format!("rename {}: {e}", self.path.display()))
        })?;
        Ok(())
    }
}

impl Keychain for FsKeychain {
    fn store(&self, id: &str, password: &str) -> Result<(), ConnectionError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
        g.insert(id.to_string(), password.to_string());
        self.flush(&g)
    }

    fn get(&self, id: &str) -> Result<Option<String>, ConnectionError> {
        let g = self
            .inner
            .lock()
            .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
        Ok(g.get(id).cloned())
    }

    fn delete(&self, id: &str) -> Result<(), ConnectionError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
        if g.remove(id).is_some() {
            self.flush(&g)
        } else {
            Ok(())
        }
    }
}

/// Decorator that layers two keychains: writes to both, reads from primary
/// first and falls back to secondary on `Ok(None)` or error.
///
/// Used to back the OS keychain with `FsKeychain` in dev builds. Without this,
/// macOS dev-mode binary signature drift makes the OS layer return `NoEntry`
/// for entries that were stored before the rebuild — the secondary preserves
/// those passwords across restarts.
pub struct LayeredKeychain {
    primary: Box<dyn Keychain>,
    secondary: Box<dyn Keychain>,
}

impl LayeredKeychain {
    #[must_use]
    pub fn new(primary: Box<dyn Keychain>, secondary: Box<dyn Keychain>) -> Self {
        Self { primary, secondary }
    }
}

impl Keychain for LayeredKeychain {
    fn store(&self, id: &str, password: &str) -> Result<(), ConnectionError> {
        // Write to both. If primary fails but secondary succeeds, treat as
        // success — the password is still recoverable on next get().
        let primary = self.primary.store(id, password);
        let secondary = self.secondary.store(id, password);
        match (primary, secondary) {
            (Ok(()), _) | (Err(_), Ok(())) => Ok(()),
            (Err(e), Err(_)) => Err(e),
        }
    }

    fn get(&self, id: &str) -> Result<Option<String>, ConnectionError> {
        match self.primary.get(id) {
            Ok(Some(p)) => Ok(Some(p)),
            Ok(None) => self.secondary.get(id),
            Err(err) => match self.secondary.get(id) {
                Ok(Some(p)) => Ok(Some(p)),
                // Either secondary returned `Ok(None)` (entry truly missing)
                // or secondary itself failed — bubble the primary error in
                // both cases so the caller sees the more diagnostic message.
                Ok(None) | Err(_) => Err(err),
            },
        }
    }

    fn delete(&self, id: &str) -> Result<(), ConnectionError> {
        // Always attempt both — leaving a stale secondary copy after the user
        // deleted the connection would leak credentials.
        let _ = self.primary.delete(id);
        self.secondary.delete(id)
    }
}

/// Decorator that caches successful `get` results in memory.
///
/// Defends against macOS dev-mode keychain ACL drops where the first call
/// returns a password and a subsequent call within the same process returns
/// `NoEntry`. `store` and `delete` invalidate the entry so the cache never
/// leaks stale credentials past an Edit / Delete.
pub struct CachingKeychain {
    inner: Box<dyn Keychain>,
    cache: Mutex<HashMap<String, String>>,
}

impl CachingKeychain {
    #[must_use]
    pub fn new(inner: Box<dyn Keychain>) -> Self {
        Self {
            inner,
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl Keychain for CachingKeychain {
    fn store(&self, id: &str, password: &str) -> Result<(), ConnectionError> {
        self.inner.store(id, password)?;
        let mut g = self
            .cache
            .lock()
            .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
        g.insert(id.to_string(), password.to_string());
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Option<String>, ConnectionError> {
        // Cache hit short-circuits the OS keychain entirely.
        {
            let g = self
                .cache
                .lock()
                .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
            if let Some(v) = g.get(id) {
                return Ok(Some(v.clone()));
            }
        }
        let result = self.inner.get(id)?;
        if let Some(ref pw) = result {
            // Promote successful reads into the cache so future lookups in
            // this process don't depend on the OS layer's mood.
            let mut g = self
                .cache
                .lock()
                .map_err(|e| ConnectionError::Keychain(e.to_string()))?;
            g.insert(id.to_string(), pw.clone());
        }
        Ok(result)
    }

    fn delete(&self, id: &str) -> Result<(), ConnectionError> {
        let outcome = self.inner.delete(id);
        // Always drop the cache entry even if the OS delete failed — keeping
        // a cached copy of a password the user just removed would be worse
        // than losing the side-effect on disk.
        if let Ok(mut g) = self.cache.lock() {
            g.remove(id);
        }
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_round_trip() {
        let kc = MemoryKeychain::new();
        kc.store("id-1", "secret").unwrap();
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("secret"));
        kc.delete("id-1").unwrap();
        assert_eq!(kc.get("id-1").unwrap(), None);
    }

    #[test]
    fn memory_get_missing_is_none() {
        let kc = MemoryKeychain::new();
        assert_eq!(kc.get("missing").unwrap(), None);
    }

    #[test]
    fn memory_delete_idempotent() {
        let kc = MemoryKeychain::new();
        kc.delete("never-existed").unwrap();
        kc.store("x", "y").unwrap();
        kc.delete("x").unwrap();
        kc.delete("x").unwrap();
    }

    /// Test backend that "forgets" entries between calls to simulate the
    /// macOS dev-keychain ACL drop. The first `get` returns a password,
    /// after which the entry mysteriously disappears. Used to verify
    /// `CachingKeychain` survives this scenario.
    struct FlakyOnce {
        first: Mutex<HashMap<String, String>>,
        consumed: Mutex<bool>,
    }
    impl Keychain for FlakyOnce {
        fn store(&self, id: &str, pw: &str) -> Result<(), ConnectionError> {
            self.first
                .lock()
                .unwrap()
                .insert(id.to_string(), pw.to_string());
            Ok(())
        }
        fn get(&self, id: &str) -> Result<Option<String>, ConnectionError> {
            let mut consumed = self.consumed.lock().unwrap();
            if *consumed {
                return Ok(None);
            }
            *consumed = true;
            Ok(self.first.lock().unwrap().get(id).cloned())
        }
        fn delete(&self, id: &str) -> Result<(), ConnectionError> {
            self.first.lock().unwrap().remove(id);
            Ok(())
        }
    }

    #[test]
    fn caching_layer_survives_flaky_backend() {
        let inner: Box<dyn Keychain> = Box::new(FlakyOnce {
            first: Mutex::new(HashMap::new()),
            consumed: Mutex::new(false),
        });
        let kc = CachingKeychain::new(inner);
        kc.store("id-1", "secret").unwrap();
        // First get reaches the inner backend.
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("secret"));
        // Second get would hit the (now-poisoned) inner backend, but the
        // cache short-circuits and still returns the password.
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("secret"));
    }

    #[test]
    fn caching_layer_invalidates_on_delete() {
        let inner: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
        let kc = CachingKeychain::new(inner);
        kc.store("id-1", "secret").unwrap();
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("secret"));
        kc.delete("id-1").unwrap();
        assert_eq!(kc.get("id-1").unwrap(), None);
    }

    #[test]
    fn caching_layer_invalidates_on_store_overwrite() {
        let inner: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
        let kc = CachingKeychain::new(inner);
        kc.store("id-1", "old").unwrap();
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("old"));
        kc.store("id-1", "new").unwrap();
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("new"));
    }

    #[test]
    fn fs_keychain_round_trip_persists_across_open() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("passwords.json");
        {
            let kc = FsKeychain::open(&path).unwrap();
            kc.store("id-1", "secret").unwrap();
            kc.store("id-2", "другой").unwrap();
        }
        // Re-open simulates app restart.
        let kc = FsKeychain::open(&path).unwrap();
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("secret"));
        assert_eq!(kc.get("id-2").unwrap().as_deref(), Some("другой"));
    }

    #[test]
    fn fs_keychain_delete_persists() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("passwords.json");
        {
            let kc = FsKeychain::open(&path).unwrap();
            kc.store("id-1", "secret").unwrap();
            kc.delete("id-1").unwrap();
        }
        let kc = FsKeychain::open(&path).unwrap();
        assert_eq!(kc.get("id-1").unwrap(), None);
    }

    #[test]
    fn fs_keychain_missing_file_is_empty_map() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("does-not-exist.json");
        let kc = FsKeychain::open(&path).unwrap();
        assert_eq!(kc.get("any").unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn fs_keychain_writes_with_mode_600() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("passwords.json");
        let kc = FsKeychain::open(&path).unwrap();
        kc.store("id-1", "secret").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        // Mode includes file-type bits; mask to access bits.
        assert_eq!(mode & 0o777, 0o600);
    }

    /// Backend that returns `Ok(None)` for any get — simulates the macOS
    /// dev-mode "entry vanished after rebuild" scenario. The layered keychain
    /// must consult the secondary when the primary returns None.
    struct AlwaysEmpty;
    impl Keychain for AlwaysEmpty {
        fn store(&self, _id: &str, _pw: &str) -> Result<(), ConnectionError> {
            Ok(())
        }
        fn get(&self, _id: &str) -> Result<Option<String>, ConnectionError> {
            Ok(None)
        }
        fn delete(&self, _id: &str) -> Result<(), ConnectionError> {
            Ok(())
        }
    }

    #[test]
    fn layered_falls_back_to_secondary_when_primary_empty() {
        let primary: Box<dyn Keychain> = Box::new(AlwaysEmpty);
        let secondary: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
        let kc = LayeredKeychain::new(primary, secondary);
        kc.store("id-1", "secret").unwrap();
        // Primary is the AlwaysEmpty stub; secondary holds the real value.
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("secret"));
    }

    #[test]
    fn layered_delete_clears_both_layers() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("passwords.json");
        let primary: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
        let secondary: Box<dyn Keychain> = Box::new(FsKeychain::open(&path).unwrap());
        let kc = LayeredKeychain::new(primary, secondary);
        kc.store("id-1", "secret").unwrap();
        kc.delete("id-1").unwrap();
        assert_eq!(kc.get("id-1").unwrap(), None);
        // Re-open the FS layer to confirm the deletion was persisted.
        let fresh = FsKeychain::open(&path).unwrap();
        assert_eq!(fresh.get("id-1").unwrap(), None);
    }

    /// Backend that always errors on get — simulates a hard keychain failure.
    /// `LayeredKeychain` must still try the secondary.
    struct AlwaysError;
    impl Keychain for AlwaysError {
        fn store(&self, _id: &str, _pw: &str) -> Result<(), ConnectionError> {
            Err(ConnectionError::Keychain("simulated hard failure".into()))
        }
        fn get(&self, _id: &str) -> Result<Option<String>, ConnectionError> {
            Err(ConnectionError::Keychain("simulated hard failure".into()))
        }
        fn delete(&self, _id: &str) -> Result<(), ConnectionError> {
            Err(ConnectionError::Keychain("simulated hard failure".into()))
        }
    }

    #[test]
    fn layered_get_consults_secondary_when_primary_errors() {
        let primary: Box<dyn Keychain> = Box::new(AlwaysError);
        let secondary: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
        let kc = LayeredKeychain::new(primary, secondary);
        // Direct write to secondary (simulating an OS-keychain-broken environment
        // where the only place the password lives is the FS fallback).
        kc.secondary.store("id-1", "secret").unwrap();
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("secret"));
    }

    #[test]
    fn layered_store_succeeds_when_only_secondary_works() {
        let primary: Box<dyn Keychain> = Box::new(AlwaysError);
        let secondary: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
        let kc = LayeredKeychain::new(primary, secondary);
        // Primary errors, secondary succeeds — overall result must be Ok so
        // the user sees their password as saved.
        assert!(kc.store("id-1", "secret").is_ok());
        assert_eq!(kc.get("id-1").unwrap().as_deref(), Some("secret"));
    }
}
