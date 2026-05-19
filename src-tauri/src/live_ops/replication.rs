//! — Replication tab fetcher.

use chrono::Utc;
use deadpool_postgres::Pool;
use regex::Regex;
use std::sync::OnceLock;

use crate::live_ops::map_err;
use crate::live_ops::types::{
    LiveOpsError, PublicationRow, ReplicationOverview, ReplicationSlotRow, SubscriptionRow,
    SubscriptionStat,
};

const SLOTS_SQL: &str = r"
SELECT s.slot_name, s.slot_type, s.database, s.active, s.wal_status,
       pg_wal_lsn_diff(pg_current_wal_lsn(), s.restart_lsn) AS lag_bytes,
       EXTRACT(EPOCH FROM (now() - r.reply_time))::float8 AS lag_seconds,
       r.state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), s.restart_lsn) AS retention_bytes,
       CASE
         WHEN current_setting('wal_keep_size', true) IS NOT NULL
              AND current_setting('wal_keep_size')::bigint > 0
         THEN pg_wal_lsn_diff(pg_current_wal_lsn(), s.restart_lsn)::float8
            / current_setting('wal_keep_size')::float8
         ELSE NULL
       END AS retention_pct_of_max
  FROM pg_replication_slots s
  LEFT JOIN pg_stat_replication r ON r.application_name = s.slot_name;
";

const PUBLICATIONS_SQL: &str = r"
SELECT p.pubname, p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate,
       (SELECT count(*) FROM pg_publication_tables WHERE pubname = p.pubname)::bigint AS table_count
  FROM pg_publication p;
";

const SUBSCRIPTIONS_SQL: &str = r"
SELECT s.subname, s.subenabled,
       regexp_replace(s.subconninfo, 'password=[^ ]*', 'password=***', 'g') AS subconninfo_redacted,
       s.subpublications AS publications,
       ss.received_lsn::text AS received_lsn_str,
       ss.last_msg_send_time::text AS last_msg_send_time_str,
       ss.latest_end_time::text AS latest_end_time_str
  FROM pg_subscription s
  LEFT JOIN pg_stat_subscription ss ON ss.subid = s.oid;
";

#[allow(clippy::missing_errors_doc)]
pub async fn fetch_replication(pool: &Pool) -> Result<ReplicationOverview, LiveOpsError> {
    let client = pool.get().await.map_err(|_| LiveOpsError::NotConnected)?;

    let slot_rows = client.query(SLOTS_SQL, &[]).await.map_err(map_err)?;
    let slots: Vec<ReplicationSlotRow> = slot_rows
        .iter()
        .map(|r| ReplicationSlotRow {
            slot_name: r.get::<_, Option<String>>(0).unwrap_or_default(),
            slot_type: r.get::<_, Option<String>>(1).unwrap_or_default(),
            database: r.get::<_, Option<String>>(2),
            active: r.get::<_, Option<bool>>(3).unwrap_or(false),
            wal_status: r.get::<_, Option<String>>(4),
            lag_bytes: r.get::<_, Option<i64>>(5),
            lag_seconds: r.get::<_, Option<f64>>(6),
            state: r.get::<_, Option<String>>(7),
            retention_bytes: r.get::<_, Option<i64>>(8),
            retention_pct_of_max: r.get::<_, Option<f64>>(9),
        })
        .collect();

    let pub_rows = client.query(PUBLICATIONS_SQL, &[]).await.map_err(map_err)?;
    let publications: Vec<PublicationRow> = pub_rows
        .iter()
        .map(|r| PublicationRow {
            pubname: r.get::<_, Option<String>>(0).unwrap_or_default(),
            puballtables: r.get::<_, Option<bool>>(1).unwrap_or(false),
            pubinsert: r.get::<_, Option<bool>>(2).unwrap_or(false),
            pubupdate: r.get::<_, Option<bool>>(3).unwrap_or(false),
            pubdelete: r.get::<_, Option<bool>>(4).unwrap_or(false),
            pubtruncate: r.get::<_, Option<bool>>(5).unwrap_or(false),
            table_count: r.get::<_, Option<i64>>(6).unwrap_or(0),
        })
        .collect();

    let sub_rows = client
        .query(SUBSCRIPTIONS_SQL, &[])
        .await
        .map_err(map_err)?;
    let subscriptions: Vec<SubscriptionRow> = sub_rows
        .iter()
        .map(|r| {
            let conninfo_sql_redacted: String = r.get::<_, Option<String>>(2).unwrap_or_default();
            let conninfo_full_redacted = redact_conninfo(&conninfo_sql_redacted);
            let received_lsn = r.get::<_, Option<String>>(4);
            let last_msg = r.get::<_, Option<String>>(5);
            let latest_end = r.get::<_, Option<String>>(6);
            let stat = if received_lsn.is_some() || last_msg.is_some() || latest_end.is_some() {
                Some(SubscriptionStat {
                    received_lsn,
                    last_msg_send_time: last_msg,
                    latest_end_time: latest_end,
                })
            } else {
                None
            };
            SubscriptionRow {
                subname: r.get::<_, Option<String>>(0).unwrap_or_default(),
                subenabled: r.get::<_, Option<bool>>(1).unwrap_or(false),
                subconninfo_redacted: conninfo_full_redacted,
                publications: r.get::<_, Option<Vec<String>>>(3).unwrap_or_default(),
                stat,
            }
        })
        .collect();

    Ok(ReplicationOverview {
        slots,
        publications,
        subscriptions,
        fetched_at: Utc::now().to_rfc3339(),
    })
}

/// Defense-in-depth: SQL already redacts via `regexp_replace`, but the
/// regex pattern here covers both `password=...` and URI-form
/// `://user:pass@host` shapes.
pub(crate) fn redact_conninfo(s: &str) -> String {
    static KV: OnceLock<Regex> = OnceLock::new();
    static URI: OnceLock<Regex> = OnceLock::new();
    let kv = KV.get_or_init(|| Regex::new(r"password=[^ ]*").unwrap());
    let uri = URI.get_or_init(|| Regex::new(r"://([^:]+):([^@]+)@").unwrap());
    // First: URI form (preserves user)
    let after_uri = uri.replace_all(s, "://$1:***@").into_owned();
    // Then: kv form
    kv.replace_all(&after_uri, "password=***").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_conninfo_redacts_kv_form() {
        assert_eq!(
            redact_conninfo("host=db.example.com user=replica password=s3cret port=5432"),
            "host=db.example.com user=replica password=*** port=5432"
        );
    }

    #[test]
    fn redact_conninfo_redacts_uri_form() {
        assert_eq!(
            redact_conninfo("postgres://replica:s3cret@db.example.com:5432/main"),
            "postgres://replica:***@db.example.com:5432/main"
        );
    }

    #[test]
    fn redact_conninfo_handles_empty() {
        assert_eq!(redact_conninfo(""), "");
    }
}
