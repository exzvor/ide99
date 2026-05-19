-- 008_health_snapshots.sql
-- Sprint 12 — local SQLite history of db_size_bytes per connection.
-- Writer logic guarantees ≥1h gap and 30d retention (see snapshots::save).

CREATE TABLE health_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  taken_at      TEXT NOT NULL,            -- ISO-8601 UTC
  db_size_bytes INTEGER NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_health_snapshots_conn_time
  ON health_snapshots(connection_id, taken_at DESC);
