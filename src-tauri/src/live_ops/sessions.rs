//! — Sessions tab data fetcher.

use chrono::Utc;
use deadpool_postgres::Pool;

use crate::live_ops::map_err;
use crate::live_ops::types::{BlockingEdge, LiveOpsError, Session, SessionsMode, SessionsSnapshot};

const SESSIONS_CAP: usize = 200;

const ACTIVITY_BLOCKED: &str = r"
WITH activity AS (  SELECT pid, state, usename, application_name, client_addr::text AS client_addr,
         LEFT(query, 1024) AS query, query_start::text AS query_start_str,
         EXTRACT(EPOCH FROM (now() - query_start))::float8 AS duration_seconds,
         wait_event_type, wait_event, backend_type,
         pg_blocking_pids(pid) AS blockers
    FROM pg_stat_activity
   WHERE datname = current_database()
     AND backend_type = 'client backend'
)
SELECT pid, state, usename, application_name, client_addr,
       query, query_start_str, duration_seconds,
       wait_event_type, wait_event, backend_type
  FROM activity
 WHERE cardinality(blockers) > 0
    OR pid IN (SELECT unnest(blockers) FROM activity WHERE cardinality(blockers) > 0)
 LIMIT $1::bigint;
";

const ACTIVITY_ALL: &str = r"
SELECT pid, state, usename, application_name, client_addr::text,
       LEFT(query, 1024) AS query, query_start::text,
       EXTRACT(EPOCH FROM (now() - query_start))::float8 AS duration_seconds,
       wait_event_type, wait_event, backend_type
  FROM pg_stat_activity
 WHERE datname = current_database()
   AND backend_type = 'client backend'
 LIMIT $1::bigint;
";

const EDGES: &str = r"
SELECT bl.locktype, bl.mode, bl.relation::regclass::text AS relation,
       (pg_blocking_pids(a.pid))[1] AS blocker_pid,
       a.pid AS blocked_pid
  FROM pg_stat_activity a
  LEFT JOIN pg_locks bl
    ON bl.pid = (pg_blocking_pids(a.pid))[1] AND bl.granted
 WHERE a.datname = current_database()
   AND cardinality(pg_blocking_pids(a.pid)) > 0;
";

#[allow(clippy::missing_errors_doc)]
pub async fn fetch_sessions(    pool: &Pool,
    mode: SessionsMode,
) -> Result<SessionsSnapshot, LiveOpsError> {
    let client = pool.get().await.map_err(|_| LiveOpsError::NotConnected)?;
    let activity_sql = match mode {
        SessionsMode::Blocked => ACTIVITY_BLOCKED,
        SessionsMode::All => ACTIVITY_ALL,
    };
    let limit_param: i64 = i64::try_from(SESSIONS_CAP + 1).unwrap_or(i64::MAX);
    let rows = client
        .query(activity_sql, &[&limit_param])
        .await
        .map_err(map_err)?;
    let truncated = rows.len() > SESSIONS_CAP;
    let sessions: Vec<Session> = rows
        .iter()
        .take(SESSIONS_CAP)
        .map(|r| Session {
            pid: r.get::<_, i32>(0),
            state: r.get::<_, Option<String>>(1).unwrap_or_default(),
            username: r.get::<_, Option<String>>(2).unwrap_or_default(),
            application_name: r.get::<_, Option<String>>(3),
            client_addr: r.get::<_, Option<String>>(4),
            query: r.get::<_, Option<String>>(5).unwrap_or_default(),
            query_start: r.get::<_, Option<String>>(6),
            duration_seconds: r.get::<_, Option<f64>>(7),
            wait_event_type: r.get::<_, Option<String>>(8),
            wait_event: r.get::<_, Option<String>>(9),
            backend_type: r.get::<_, Option<String>>(10).unwrap_or_default(),
        })
        .collect();

    let edge_rows = client.query(EDGES, &[]).await.map_err(map_err)?;
    let blocking_edges: Vec<BlockingEdge> = edge_rows
        .iter()
        .map(|r| BlockingEdge {
            blocker_pid: r.get::<_, Option<i32>>(3).unwrap_or(0),
            blocked_pid: r.get::<_, i32>(4),
            lock_mode: r.get::<_, Option<String>>(1),
            lock_type: r.get::<_, Option<String>>(0),
            relation: r.get::<_, Option<String>>(2),
        })
        .filter(|e| e.blocker_pid != 0)
        .collect();

    Ok(SessionsSnapshot {
        sessions,
        blocking_edges,
        fetched_at: Utc::now().to_rfc3339(),
        truncated,
    })
}
