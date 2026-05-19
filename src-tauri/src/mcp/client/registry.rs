//! `Arc<RwLock<HashMap>>`-style registry for active MCP client connections.
//! One entry per configured server, keyed by user-provided name.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::mcp::client::config::McpClientConfig;
use crate::mcp::client::connection::{ClientConnection, ConnectionStatus};
use crate::mcp::server::McpError;

/// Holds the live `ClientConnection`s keyed by their config name.
/// Stored on `AppState` so commands can reach it.
#[derive(Default)]
pub struct ClientRegistry {
    inner: RwLock<HashMap<String, Arc<ClientConnection>>>,
}

impl ClientRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace the registry contents from a freshly-loaded config.
    /// Existing connections that disappear are disconnected; new ones are
    /// instantiated in `Disconnected` state. This is the path used at boot
    /// and on `mcp_client_reload`.
    pub async fn sync_from_config(&self, cfg: &McpClientConfig) -> Result<(), McpError> {
        let mut g = self.inner.write().await;

        // Disconnect anything that's been removed from the file.
        let to_remove: Vec<String> = g
            .keys()
            .filter(|k| !cfg.mcp_servers.contains_key(*k))
            .cloned()
            .collect();
        for k in to_remove {
            if let Some(c) = g.remove(&k) {
                let _ = c.disconnect().await;
            }
        }

        for (name, entry) in &cfg.mcp_servers {
            // Replace an existing entry if its definition changed; preserve
            // the live connection if the entry is byte-equal (no `PartialEq`
            // on `McpServerEntry`, so we use serde — cheap, ~tens of bytes).
            let new_json = serde_json::to_string(entry).unwrap_or_default();
            let needs_replace = match g.get(name) {
                Some(existing) => {
                    let cur_json = serde_json::to_string(&existing.entry).unwrap_or_default();
                    cur_json != new_json
                }
                None => true,
            };
            if needs_replace {
                if let Some(c) = g.remove(name) {
                    let _ = c.disconnect().await;
                }
                g.insert(                    name.clone(),
                    Arc::new(ClientConnection::new(name.clone(), entry.clone())),
);
            }
        }
        Ok(())
    }

    /// Connect every entry whose `autoStart` is true. Returns the names of
    /// servers that failed (each with their error). Successful connections
    /// stay in `Connected` state in the registry.
    pub async fn auto_start_all(&self) -> Vec<(String, McpError)> {
        let snap: Vec<Arc<ClientConnection>> = {
            let g = self.inner.read().await;
            g.values().cloned().collect()
        };
        let mut failures = Vec::new();
        for c in snap {
            let auto = match &c.entry {
                crate::mcp::client::config::McpServerEntry::Stdio { auto_start, .. }
                | crate::mcp::client::config::McpServerEntry::Http { auto_start, .. } => {
                    *auto_start
                }
            };
            if !auto {
                continue;
            }
            if let Err(e) = c.connect().await {
                failures.push((c.name.clone(), e));
            }
        }
        failures
    }

    /// Snapshot for `mcp_client_list`. Each entry has the cached `tools` /
    /// `resources` if Connected, or the last error message.
    pub async fn snapshot(&self) -> Vec<(String, ConnectionStatus)> {
        let g = self.inner.read().await;
        let mut out = Vec::with_capacity(g.len());
        for c in g.values() {
            let s = c.status.lock().await.clone();
            out.push((c.name.clone(), s));
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    pub async fn get(&self, name: &str) -> Option<Arc<ClientConnection>> {
        self.inner.read().await.get(name).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::client::config::{McpClientConfig, McpServerEntry};

    fn stdio_entry(auto_start: bool) -> McpServerEntry {
        McpServerEntry::Stdio {
            transport: "stdio".into(),
            command: "true".into(), // /usr/bin/true — exits clean
            args: vec![],
            env: Default::default(),
            auto_start,
        }
    }

    #[tokio::test]
    async fn sync_adds_new_entries_in_disconnected_state() {
        let r = ClientRegistry::new();
        let mut cfg = McpClientConfig::default();
        cfg.mcp_servers.insert("a".into(), stdio_entry(false));
        r.sync_from_config(&cfg).await.unwrap();
        let snap = r.snapshot().await;
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].0, "a");
        assert!(matches!(snap[0].1, ConnectionStatus::Disconnected));
    }

    #[tokio::test]
    async fn sync_removes_dropped_entries() {
        let r = ClientRegistry::new();
        let mut cfg = McpClientConfig::default();
        cfg.mcp_servers.insert("a".into(), stdio_entry(false));
        cfg.mcp_servers.insert("b".into(), stdio_entry(false));
        r.sync_from_config(&cfg).await.unwrap();
        cfg.mcp_servers.remove("b");
        r.sync_from_config(&cfg).await.unwrap();
        let snap = r.snapshot().await;
        let names: Vec<&str> = snap.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["a"]);
    }

    #[tokio::test]
    async fn snapshot_is_sorted_by_name() {
        let r = ClientRegistry::new();
        let mut cfg = McpClientConfig::default();
        cfg.mcp_servers.insert("zeta".into(), stdio_entry(false));
        cfg.mcp_servers.insert("alpha".into(), stdio_entry(false));
        r.sync_from_config(&cfg).await.unwrap();
        let snap = r.snapshot().await;
        assert_eq!(snap[0].0, "alpha");
        assert_eq!(snap[1].0, "zeta");
    }
}
