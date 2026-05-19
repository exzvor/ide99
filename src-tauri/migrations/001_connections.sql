-- 001_connections.sql
-- Sprint 2 — Connection Manager schema

CREATE TABLE IF NOT EXISTS connections (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  host            TEXT NOT NULL,
  port            INTEGER NOT NULL DEFAULT 5432,
  database        TEXT NOT NULL,
  username        TEXT NOT NULL,
  ssl_mode        TEXT NOT NULL DEFAULT 'prefer',
  has_password    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_tested_at  TEXT,
  last_test_ok    INTEGER
);

CREATE INDEX IF NOT EXISTS connections_name_idx ON connections(name);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
