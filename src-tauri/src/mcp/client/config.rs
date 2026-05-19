//! `~/.config/ide99/mcp-servers.json` — schema, load, save.
//!
//! Format mirrors the de-facto standard used by Claude Code, Cursor,
//! Windsurf, etc. (`mcpServers: { name: { command/args/env } | { transport,
//! url, auth } }`), so users can copy-paste between IDE configs.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::mcp::server::McpError;

/// Top-level shape on disk.
///
/// ```json
/// {
/// "mcpServers": {
/// "linear": { "command": "npx", "args": ["-y", "@linear/mcp-server"], "autoStart": true },
/// "github": { "transport": "http", "url": "https://...", "auth": "bearer:${GITHUB_TOKEN}", "autoStart": false }
/// }
/// }
/// ```
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClientConfig {
    /// `BTreeMap` for stable ordering on disk (saves diff-friendly).
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: BTreeMap<String, McpServerEntry>,
}

/// A single configured external MCP server.
///
/// Tagged union over `transport`. When `transport` is omitted, defaults to
/// `"stdio"` (the most common case — matches Claude Code/Cursor convention).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum McpServerEntry {
    /// stdio subprocess (e.g. npx-spawned MCP server).
    Stdio {
        #[serde(default = "default_stdio_transport")]
        transport: String,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default, rename = "autoStart")]
        auto_start: bool,
    },
    /// HTTP/SSE remote MCP server.
    Http {
        transport: String, // "http"
        url: String,
        /// `bearer:<token>` or `bearer:${ENV_VAR}`. ide99 expands `${VAR}` at
        /// connection time so secrets stay out of the JSON.
        #[serde(default)]
        auth: Option<String>,
        #[serde(default, rename = "autoStart")]
        auto_start: bool,
    },
}

fn default_stdio_transport() -> String {
    "stdio".into()
}

/// UI-facing summary of one entry — what `mcp_client_list` returns.
/// Frontend never sees env values or expanded auth tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalServerConfig {
    pub name: String,
    pub transport: String,
    /// `command + args` for stdio, or `url` for http. Display-only.
    pub display_target: String,
    pub auto_start: bool,
}

impl McpClientConfig {
    /// Load and parse the config. Missing file → empty config (not an error;
    /// users without external MCP servers shouldn't see ENOENT noise).
    pub fn load(path: &Path) -> Result<Self, McpError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let bytes = std::fs::read(path).map_err(McpError::from)?;
        let cfg: Self = serde_json::from_slice(&bytes)
            .map_err(|e| McpError::Internal(format!("invalid mcp-servers.json: {e}")))?;
        Ok(cfg)
    }

    /// Save with pretty-print (2-space indent) so users can hand-edit.
    pub fn save(&self, path: &Path) -> Result<(), McpError> {
        let bytes = serde_json::to_vec_pretty(self)
            .map_err(|e| McpError::Internal(format!("encode mcp-servers.json: {e}")))?;
        std::fs::write(path, bytes).map_err(McpError::from)?;
        Ok(())
    }

    /// Project to UI-facing summaries (no secrets).
    #[must_use]
    pub fn to_summaries(&self) -> Vec<ExternalServerConfig> {
        self.mcp_servers
            .iter()
            .map(|(name, entry)| match entry {
                McpServerEntry::Stdio {
                    command,
                    args,
                    auto_start,
                    ..
                } => {
                    let target = if args.is_empty() {
                        command.clone()
                    } else {
                        format!("{} {}", command, args.join(" "))
                    };
                    ExternalServerConfig {
                        name: name.clone(),
                        transport: "stdio".into(),
                        display_target: target,
                        auto_start: *auto_start,
                    }
                }
                McpServerEntry::Http {
                    url, auto_start, ..
                } => ExternalServerConfig {
                    name: name.clone(),
                    transport: "http".into(),
                    display_target: url.clone(),
                    auto_start: *auto_start,
                },
            })
            .collect()
    }
}

/// Expand `${ENV_VAR}` references in `auth` and `env` values. Missing vars
/// stay as `${VAR}` literally — caller decides whether to fail or warn.
#[must_use]
pub fn expand_env(template: &str) -> String {
    // Cheap hand-rolled scanner. No regex dep needed; the surface is tiny.
    let mut out = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'$' && bytes[i + 1] == b'{' {
            if let Some(end) = template[i + 2..].find('}') {
                let var_name = &template[i + 2..i + 2 + end];
                if let Ok(val) = std::env::var(var_name) {
                    out.push_str(&val);
                    i += 2 + end + 1;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_example() {
        let json = r#"{
            "mcpServers": {
                "linear": {
                    "command": "npx",
                    "args": ["-y", "@linear/mcp-server"],
                    "env": { "LINEAR_API_KEY": "${LINEAR_API_KEY}" },
                    "autoStart": true
                },
                "github": {
                    "transport": "http",
                    "url": "https://mcp.example.com/github",
                    "auth": "bearer:${GH_TOKEN}",
                    "autoStart": false
                }
            }
        }"#;
        let cfg: McpClientConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.mcp_servers.len(), 2);
        let linear = cfg.mcp_servers.get("linear").unwrap();
        match linear {
            McpServerEntry::Stdio {
                command,
                args,
                auto_start,
                ..
            } => {
                assert_eq!(command, "npx");
                assert_eq!(args, &["-y".to_string(), "@linear/mcp-server".into()]);
                assert!(*auto_start);
            }
            _ => panic!("expected stdio variant"),
        }
        let gh = cfg.mcp_servers.get("github").unwrap();
        match gh {
            McpServerEntry::Http {
                url, auto_start, ..
            } => {
                assert_eq!(url, "https://mcp.example.com/github");
                assert!(!*auto_start);
            }
            _ => panic!("expected http variant"),
        }
    }

    #[test]
    fn missing_file_is_empty_config() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = McpClientConfig::load(&dir.path().join("nope.json")).unwrap();
        assert!(cfg.mcp_servers.is_empty());
    }

    #[test]
    fn round_trip_save_load() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("mcp-servers.json");

        let mut cfg = McpClientConfig::default();
        cfg.mcp_servers.insert(            "x".into(),
            McpServerEntry::Stdio {
                transport: "stdio".into(),
                command: "echo".into(),
                args: vec!["hi".into()],
                env: BTreeMap::new(),
                auto_start: false,
            },
);
        cfg.save(&p).unwrap();
        let reloaded = McpClientConfig::load(&p).unwrap();
        assert_eq!(reloaded.mcp_servers.len(), 1);
    }

    #[test]
    fn summaries_hide_secrets() {
        let mut cfg = McpClientConfig::default();
        cfg.mcp_servers.insert(            "linear".into(),
            McpServerEntry::Stdio {
                transport: "stdio".into(),
                command: "npx".into(),
                args: vec!["-y".into(), "@linear/mcp-server".into()],
                env: BTreeMap::from([("LINEAR_API_KEY".into(), "secret".into())]),
                auto_start: true,
            },
);
        let summaries = cfg.to_summaries();
        let s = serde_json::to_string(&summaries[0]).unwrap();
        assert!(!s.contains("secret")); // env is dropped on summary
        assert!(s.contains("npx -y @linear/mcp-server"));
    }

    #[test]
    fn expand_env_substitutes_known_vars() {
        std::env::set_var("IDE99_TEST_VAR", "value42");
        let out = expand_env("prefix-${IDE99_TEST_VAR}-suffix");
        assert_eq!(out, "prefix-value42-suffix");
        std::env::remove_var("IDE99_TEST_VAR");
    }

    #[test]
    fn expand_env_leaves_missing_vars_intact() {
        let out = expand_env("hello ${IDE99_DEFINITELY_UNSET_XYZ}");
        assert!(out.contains("${IDE99_DEFINITELY_UNSET_XYZ}"));
    }
}
