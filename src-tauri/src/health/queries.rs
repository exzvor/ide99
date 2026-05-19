#![allow(clippy::doc_markdown)]

//! — SQL query constants for the Health Screen.
//!
//! Each constant is paired with a handler in `commands.rs`. Verbatim SQL
//! per spec §4.4. The bloat estimate query is the public-domain
//! ioguix `pgsql_bloat_estimates` formula — pure SQL, no extension
//! required.

/// `pg_database_size` + `pg_size_pretty` for the current database.
pub const DB_SIZE: &str = "SELECT \
    pg_database_size(current_database())::bigint AS bytes, \
    pg_size_pretty(pg_database_size(current_database())) AS pretty";

/// ioguix bloat estimate (public domain).
///
/// Source: <https://github.com/ioguix/pgsql-bloat-estimation>. Returns
/// top-10 user tables ordered by estimated bloat in bytes, filtered to
/// `bloat_pct > 10`. Pure SQL — no extensions required. Adapted to
/// surface columns in our DTO order: schema, table, `bloat_pct`,
/// `bloat_bytes`.
pub const BLOAT_TOP: &str = r"
SELECT
  schemaname AS schema,
  tblname    AS table,
  CASE WHEN tblpages - est_tblpages_ff > 0
       THEN 100 * (tblpages - est_tblpages_ff)::float8 / tblpages
       ELSE 0 END AS bloat_pct,
  CASE WHEN tblpages - est_tblpages_ff > 0
       THEN ((tblpages - est_tblpages_ff) * bs)::bigint
       ELSE 0::bigint END AS bloat_bytes
FROM (  SELECT ceil(reltuples / ((bs - page_hdr) / tpl_size)) + ceil(toasttuples / 4) AS est_tblpages,
         ceil(reltuples / ((bs - page_hdr) * fillfactor / (tpl_size * 100))) + ceil(toasttuples / 4) AS est_tblpages_ff,
         tblpages, fillfactor, bs, tblid, schemaname, tblname, heappages, toastpages, is_na
  FROM (    SELECT
      (4 + tpl_hdr_size + tpl_data_size + (2 * ma)
        - CASE WHEN tpl_hdr_size % ma = 0 THEN ma ELSE tpl_hdr_size % ma END
        - CASE WHEN ceil(tpl_data_size)::int % ma = 0 THEN ma ELSE ceil(tpl_data_size)::int % ma END
) AS tpl_size,
      bs - page_hdr AS size_per_block,
      (heappages + toastpages) AS tblpages, heappages, toastpages, reltuples, toasttuples,
      bs, page_hdr, tblid, schemaname, tblname, fillfactor, is_na
    FROM (      SELECT
        tbl.oid AS tblid, ns.nspname AS schemaname, tbl.relname AS tblname, tbl.reltuples,
        tbl.relpages AS heappages,
        coalesce(toast.relpages, 0) AS toastpages,
        coalesce(toast.reltuples, 0) AS toasttuples,
        coalesce(substring(          array_to_string(tbl.reloptions, ' ') FROM 'fillfactor=([0-9]+)')::smallint, 100) AS fillfactor,
        current_setting('block_size')::numeric AS bs,
        CASE WHEN version()~'mingw32' OR version()~'64-bit|x86_64|ppc64|ia64|amd64' THEN 8 ELSE 4 END AS ma,
        24 AS page_hdr,
        23 + CASE WHEN MAX(coalesce(s.null_frac,0)) > 0 THEN (7 + count(s.attname)) / 8 ELSE 0::int END
           + CASE WHEN bool_or(att.attname = 'oid' AND att.attnum < 0) THEN 4 ELSE 0 END AS tpl_hdr_size,
        sum((1 - coalesce(s.null_frac, 0)) * coalesce(s.avg_width, 0)) AS tpl_data_size,
        bool_or(att.atttypid = 'pg_catalog.name'::regtype)
        OR sum(CASE WHEN att.attnum > 0 THEN 1 ELSE 0 END) <> count(s.attname) AS is_na
      FROM pg_attribute AS att
        JOIN pg_class AS tbl ON att.attrelid = tbl.oid
        JOIN pg_namespace AS ns ON ns.oid = tbl.relnamespace
        LEFT JOIN pg_stats AS s ON s.schemaname = ns.nspname
          AND s.tablename = tbl.relname AND s.inherited = false AND s.attname = att.attname
        LEFT JOIN pg_class AS toast ON tbl.reltoastrelid = toast.oid
      WHERE NOT att.attisdropped
        AND tbl.relkind IN ('r','m')
        AND ns.nspname NOT IN ('pg_catalog','information_schema')
      GROUP BY 1,2,3,4,5,6,7,8,9,10
) AS s
) AS s2
) AS s3
WHERE NOT is_na
  AND tblpages > 0
  AND CASE WHEN tblpages - est_tblpages_ff > 0
           THEN 100 * (tblpages - est_tblpages_ff)::float8 / tblpages
           ELSE 0 END > 10
ORDER BY bloat_bytes DESC
LIMIT 10
";

/// Probe whether `pg_stat_statements` is installed. 0 rows → unavailable.
pub const PG_STAT_STATEMENTS_PROBE: &str =
    "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'";

/// Top-10 slowest queries by total exec time. PG13+ column names.
pub const SLOW_QUERIES: &str = "SELECT \
    query, \
    mean_exec_time AS mean_time_ms, \
    total_exec_time AS total_time_ms, \
    calls \
    FROM pg_stat_statements \
    ORDER BY total_exec_time DESC \
    LIMIT 10";

/// Tables with high seq-scan / idx-scan ratio — index-candidate hints.
pub const MISSING_INDEXES: &str = "SELECT \
    schemaname AS schema, \
    relname    AS table, \
    seq_scan, \
    seq_tup_read, \
    coalesce(idx_scan, 0) AS index_scan \
    FROM pg_stat_user_tables \
    WHERE seq_scan > 100 \
      AND (idx_scan = 0 OR idx_scan IS NULL OR seq_scan / NULLIF(idx_scan, 0) > 100) \
    ORDER BY seq_tup_read DESC \
    LIMIT 10";

/// Indexes with zero scans, excluding PK indexes (heuristic via name suffix).
pub const UNUSED_INDEXES: &str = "SELECT \
    schemaname    AS schema, \
    indexrelname  AS index, \
    relname       AS on_table, \
    pg_relation_size(indexrelid)::bigint AS size_bytes \
    FROM pg_stat_user_indexes \
    WHERE idx_scan = 0 \
      AND indexrelname NOT LIKE '%pkey' \
    ORDER BY pg_relation_size(indexrelid) DESC \
    LIMIT 10";

/// Cache hit ratio for the current DB. NULLIF prevents division by zero
/// on a brand-new DB with no traffic. Result is cast to float8 so
/// tokio-postgres returns it as `f64` (no `numeric`/`Decimal` dance).
pub const CACHE_HIT: &str = "SELECT \
    coalesce(\
      round(100.0 * sum(blks_hit)::numeric / NULLIF(sum(blks_hit + blks_read), 0), 2)::float8, \
      0::float8 \
) AS ratio_pct \
    FROM pg_stat_database \
    WHERE datname = current_database()";

/// Active-connection breakdown by state.
pub const ACTIVE_CONNECTIONS_BY_STATE: &str = "SELECT \
    coalesce(state, 'unknown') AS state, \
    count(*)::bigint AS cnt \
    FROM pg_stat_activity \
    WHERE datname = current_database() \
    GROUP BY state";

/// Returns max_connections as text.
pub const SHOW_MAX_CONNECTIONS: &str = "SHOW max_connections";

/// Long-running statements (>30 s). Filters background workers /
/// idle sessions / NULL queries.
pub const LONG_RUNNING: &str = "SELECT \
    pid::int AS pid, \
    EXTRACT(EPOCH FROM (now() - query_start))::float8 AS duration_seconds, \
    query, \
    coalesce(state, 'unknown') AS state, \
    coalesce(usename, '') AS username \
    FROM pg_stat_activity \
    WHERE state IS DISTINCT FROM 'idle' \
      AND query_start IS NOT NULL \
      AND query_start < now() - interval '30 seconds' \
      AND query IS NOT NULL \
      AND query <> '' \
    ORDER BY query_start ASC \
    LIMIT 50";

/// Tables whose last vacuum/autovacuum was >7d ago (or never).
pub const VACUUM_STATUS: &str = "SELECT \
    schemaname AS schema, \
    relname    AS table, \
    last_vacuum::text AS last_vacuum, \
    last_autovacuum::text AS last_autovacuum, \
    CASE WHEN GREATEST(last_vacuum, last_autovacuum) IS NULL THEN NULL \
         ELSE EXTRACT(DAY FROM now() - GREATEST(last_vacuum, last_autovacuum))::bigint \
    END AS days_since \
    FROM pg_stat_user_tables \
    WHERE GREATEST(last_vacuum, last_autovacuum) < now() - interval '7 days' \
       OR (last_vacuum IS NULL AND last_autovacuum IS NULL) \
    ORDER BY GREATEST(last_vacuum, last_autovacuum) NULLS FIRST \
    LIMIT 10";

/// Replication slots + matching `pg_stat_replication` row when present.
/// Empty result → no replicas configured (positive empty, not error).
pub const REPLICATION_LAG: &str = "SELECT \
    s.slot_name AS slot, \
    coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), s.restart_lsn), 0)::bigint AS lag_bytes, \
    EXTRACT(EPOCH FROM (now() - r.reply_time))::float8 AS lag_seconds, \
    coalesce(r.state, 'inactive') AS state \
    FROM pg_replication_slots s \
    LEFT JOIN pg_stat_replication r ON s.slot_name = r.application_name";

/// `pg_stat_wal` was added in PG 14. We probe with `to_regclass` so the
/// caller can return CardError::Unavailable on older servers without an
/// SQLSTATE handler.
pub const PG_STAT_WAL_PROBE: &str = "SELECT to_regclass('pg_catalog.pg_stat_wal') IS NOT NULL";

/// Cumulative WAL bytes + elapsed seconds since `stats_reset`. The
/// command divides one by the other to surface the average byte-rate.
pub const WAL_THROUGHPUT: &str = "SELECT \
    wal_bytes::bigint AS total_bytes, \
    coalesce(EXTRACT(EPOCH FROM (now() - stats_reset))::float8, 0) AS seconds_since_reset \
    FROM pg_stat_wal";
