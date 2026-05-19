//! HTTP client for the Instant DB beta control service.
//!
//! Each call:
//! * loads (or generates) a stable device-id from the data dir,
//! * picks the first endpoint that returns a non-network error,
//! * signs `{device_id}|{ts}|{nonce}` with HMAC-SHA256,
//! * deserialises the JSON response into a typed struct.

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use thiserror::Error;

use super::config;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Error)]
pub enum InstantDbError {
    #[error("network error: {0}")]
    Network(String),
    #[error("server returned {status}: {body}")]
    Server { status: u16, body: String },
    #[error("decode error: {0}")]
    Decode(String),
    #[error("device id store: {0}")]
    DeviceId(String),
    #[error("auth: {0}")]
    Auth(String),
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct InstantDbCreate {
    pub db_id: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub connection_string: String,
    pub created_at: String,
    pub expires_at: String,
    pub ttl_seconds: u64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct InstantDbStatus {
    pub db_id: String,
    pub status: String,
    pub expires_at: String,
    pub seconds_remaining: i64,
}

/// Read or initialise a stable per-installation device id. Stored as plain
/// text under `<data_dir>/instant_db_device_id`. Not a secret — only used as
/// the subject of the per-device server quota.
pub fn ensure_device_id(data_dir: &Path) -> Result<String, InstantDbError> {
    let path = data_dir.join("instant_db_device_id");
    if let Ok(s) = std::fs::read_to_string(&path) {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let id = format!("ide99-{:032x}", u128::from_be_bytes(bytes));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| InstantDbError::DeviceId(format!("mkdir: {e}")))?;
    }
    std::fs::write(&path, &id).map_err(|e| InstantDbError::DeviceId(format!("write: {e}")))?;
    Ok(id)
}

fn sign(device_id: &str, ts: u64, nonce: &str) -> Result<String, InstantDbError> {
    let mut mac = HmacSha256::new_from_slice(config::HMAC_SECRET.as_bytes())
        .map_err(|e| InstantDbError::Auth(format!("hmac key: {e}")))?;
    mac.update(format!("{device_id}|{ts}|{nonce}").as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

fn nonce_hex() -> String {
    let mut bytes = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn build_client() -> Result<reqwest::Client, InstantDbError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .user_agent(concat!(            "ide99/",
            env!("CARGO_PKG_VERSION"),
            " instant-db-beta"
))
        .build()
        .map_err(|e| InstantDbError::Network(format!("build client: {e}")))
}

fn headers(device_id: &str) -> Result<reqwest::header::HeaderMap, InstantDbError> {
    let ts = now_unix();
    let nonce = nonce_hex();
    let sig = sign(device_id, ts, &nonce)?;
    let mut h = reqwest::header::HeaderMap::new();
    let set = |h: &mut reqwest::header::HeaderMap,
               name: &'static str,
               value: &str|
     -> Result<(), InstantDbError> {
        h.insert(            name,
            value
                .parse()
                .map_err(|e| InstantDbError::Auth(format!("header {name}: {e}")))?,
);
        Ok(())
    };
    set(&mut h, "X-Device-Id", device_id)?;
    set(&mut h, "X-Ts", &ts.to_string())?;
    set(&mut h, "X-Nonce", &nonce)?;
    set(&mut h, "X-Signature", &sig)?;
    Ok(h)
}

async fn try_endpoints<F, Fut>(locale: &str, op: F) -> Result<reqwest::Response, InstantDbError>
where
    F: Fn(&'static str) -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    let mut last_err: Option<String> = None;
    for base in config::endpoint_candidates(locale) {
        match op(base).await {
            Ok(resp) => return Ok(resp),
            Err(e) => {
                tracing::warn!(endpoint = base, error = %e, "instant_db endpoint failed; trying next");
                last_err = Some(format!("{base}: {e}"));
            }
        }
    }
    Err(InstantDbError::Network(        last_err.unwrap_or_else(|| "no endpoints".to_string()),
))
}

async fn parse_or_error<T: serde::de::DeserializeOwned>(    resp: reqwest::Response,
) -> Result<T, InstantDbError> {
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(InstantDbError::Server {
            status: status.as_u16(),
            body,
        });
    }
    resp.json::<T>()
        .await
        .map_err(|e| InstantDbError::Decode(e.to_string()))
}

pub async fn create(data_dir: &Path, locale: &str) -> Result<InstantDbCreate, InstantDbError> {
    let device_id = ensure_device_id(data_dir)?;
    let h = headers(&device_id)?;
    let client = build_client()?;
    let resp = try_endpoints(locale, |base| {
        let url = format!("{base}/v1/instant-db");
        client.post(url).headers(h.clone()).send()
    })
    .await?;
    parse_or_error(resp).await
}

pub async fn status(    data_dir: &Path,
    locale: &str,
    db_id: &str,
) -> Result<InstantDbStatus, InstantDbError> {
    let device_id = ensure_device_id(data_dir)?;
    let h = headers(&device_id)?;
    let client = build_client()?;
    let resp = try_endpoints(locale, |base| {
        let url = format!("{base}/v1/instant-db/{db_id}");
        client.get(url).headers(h.clone()).send()
    })
    .await?;
    parse_or_error(resp).await
}

pub async fn heartbeat(    data_dir: &Path,
    locale: &str,
    db_id: &str,
) -> Result<InstantDbStatus, InstantDbError> {
    let device_id = ensure_device_id(data_dir)?;
    let h = headers(&device_id)?;
    let client = build_client()?;
    let resp = try_endpoints(locale, |base| {
        let url = format!("{base}/v1/instant-db/{db_id}/heartbeat");
        client.post(url).headers(h.clone()).send()
    })
    .await?;
    parse_or_error(resp).await
}

pub async fn delete(data_dir: &Path, locale: &str, db_id: &str) -> Result<(), InstantDbError> {
    let device_id = ensure_device_id(data_dir)?;
    let h = headers(&device_id)?;
    let client = build_client()?;
    let resp = try_endpoints(locale, |base| {
        let url = format!("{base}/v1/instant-db/{db_id}");
        client.delete(url).headers(h.clone()).send()
    })
    .await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(InstantDbError::Server {
            status: status.as_u16(),
            body,
        });
    }
    Ok(())
}
