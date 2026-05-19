// — owner: .
//
// fix: the original query targeted `_repack.repack_log`, which is
// not a table that pg_repack 1.5.3 (current LTS) installs. The supported way
// to detect active repack work across versions is `pg_stat_activity` filtered
// by application_name — the pg_repack CLI sets `application_name = 'pg_repack'`
// for both the connecting client and the worker backends. Columns are stable
// across PG versions back to 9.6 (`backend_start`, `pid`, `query`).
export const ACTIVE_JOBS_SQL = `
SELECT
  to_char(backend_start, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
  pid::text AS pid,
  query AS table_name
FROM pg_stat_activity
WHERE application_name LIKE 'pg_repack%'
  AND state IS DISTINCT FROM 'idle'
  AND pid <> pg_backend_pid()
ORDER BY backend_start DESC
LIMIT 20
`.trim();
