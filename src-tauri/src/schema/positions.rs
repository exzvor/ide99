//! — `erd_save_positions` / `erd_load_positions`.
//!
//! Persist drag positions of ERD-canvas tables per `(conn_id, schemas_key)`
//! pair to a single JSON file (`app_paths::erd_layouts_path()`).
//! Last-write-wins; no concurrency guards beyond a single tokio mutex.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::sync::Mutex;

use crate::app_paths;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePos {
    pub node_id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Default, Debug, Serialize, Deserialize)]
struct Layouts {
    /// Key = `${connId}|${schemasKey}` -> list of [`NodePos`].
    entries: BTreeMap<String, Vec<NodePos>>,
}

/// Process-wide mutex serialising the read-modify-write cycle on the JSON
/// layouts file. Two concurrent saves on different `(connId, schemasKey)`
/// pairs would otherwise race on the file body.
fn lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

/// Resolve the on-disk path. Errors from `app_paths` (no HOME, mkdir failed)
/// are flattened to `String` here so both IPC commands can share the same
/// `Result<_, String>` envelope.
fn path() -> Result<PathBuf, String> {
    app_paths::erd_layouts_path().map_err(|e| e.to_string())
}

async fn read_all() -> Result<Layouts, String> {
    let path = path()?;
    if !path.exists() {
        return Ok(Layouts::default());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Ok(Layouts::default());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

async fn write_all(layouts: &Layouts) -> Result<(), String> {
    let path = path()?;
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    let bytes = serde_json::to_vec_pretty(layouts).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| e.to_string())
}

fn key(conn_id: &str, schemas_key: &str) -> String {
    format!("{conn_id}|{schemas_key}")
}

/// Persist `positions` for the `(conn_id, schemas_key)` pair (last-write-wins).
///
/// # Errors
/// Returns the underlying `app_paths` / `serde_json` / `tokio::fs` error
/// flattened to a `String` if the data dir cannot be resolved/created or
/// the JSON file cannot be read or written.
#[tauri::command]
pub async fn erd_save_positions(    conn_id: String,
    schemas_key: String,
    positions: Vec<NodePos>,
) -> Result<(), String> {
    let _guard = lock().lock().await;
    let mut layouts = read_all().await?;
    layouts
        .entries
        .insert(key(&conn_id, &schemas_key), positions);
    write_all(&layouts).await
}

/// Load persisted positions for the `(conn_id, schemas_key)` pair.
///
/// Returns an empty vec when no entry exists yet (first ERD open / cleared).
///
/// # Errors
/// Returns a flattened `String` error when the data dir cannot be resolved
/// or the JSON file is malformed.
#[tauri::command]
pub async fn erd_load_positions(    conn_id: String,
    schemas_key: String,
) -> Result<Vec<NodePos>, String> {
    let _guard = lock().lock().await;
    let layouts = read_all().await?;
    Ok(layouts
        .entries
        .get(&key(&conn_id, &schemas_key))
        .cloned()
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_format_is_pipe_delimited() {
        assert_eq!(key("c1", "*"), "c1|*");
        assert_eq!(key("conn-42", "public,app"), "conn-42|public,app");
    }

    #[test]
    fn nodepos_round_trips_through_json() {
        let positions = vec![
            NodePos {
                node_id: "public.users".into(),
                x: 100.0,
                y: 50.0,
            },
            NodePos {
                node_id: "public.orders".into(),
                x: 400.0,
                y: 50.0,
            },
        ];
        let json = serde_json::to_string(&positions).unwrap();
        // camelCase wire shape — `nodeId`, not `node_id`.
        assert!(json.contains("\"nodeId\":\"public.users\""));
        let back: Vec<NodePos> = serde_json::from_str(&json).unwrap();
        assert_eq!(positions, back);
    }

    #[tokio::test]
    async fn save_load_roundtrip() {
        // Override IDE99_DATA_DIR to a tempdir so the on-disk persistence
        // exercises the full read_all → write_all → read_all loop without
        // touching the real user data directory.
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("IDE99_DATA_DIR", tmp.path());

        let positions = vec![
            NodePos {
                node_id: "public.users".into(),
                x: 100.0,
                y: 50.0,
            },
            NodePos {
                node_id: "public.orders".into(),
                x: 400.0,
                y: 50.0,
            },
        ];

        erd_save_positions("c1".into(), "*".into(), positions.clone())
            .await
            .unwrap();
        let loaded = erd_load_positions("c1".into(), "*".into()).await.unwrap();
        assert_eq!(loaded, positions);

        // Different (conn,schemasKey) pair returns empty.
        let empty = erd_load_positions("c1".into(), "public".into())
            .await
            .unwrap();
        assert!(empty.is_empty());

        // Saving a second (conn,schemasKey) pair leaves the first intact.
        let other = vec![NodePos {
            node_id: "app.events".into(),
            x: 10.0,
            y: 20.0,
        }];
        erd_save_positions("c2".into(), "*".into(), other.clone())
            .await
            .unwrap();
        let still = erd_load_positions("c1".into(), "*".into()).await.unwrap();
        assert_eq!(still, positions);
        let other_back = erd_load_positions("c2".into(), "*".into()).await.unwrap();
        assert_eq!(other_back, other);

        std::env::remove_var("IDE99_DATA_DIR");
    }
}
