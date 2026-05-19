-- 002_editor_tabs.sql
-- Sprint 4 — Editor tabs persistence

CREATE TABLE IF NOT EXISTS editor_tabs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK(kind IN ('editor', 'object')),
  name          TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  connection_id TEXT,
  node_key      TEXT,
  cursor_line   INTEGER NOT NULL DEFAULT 1,
  cursor_col    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS editor_tabs_created_at_idx ON editor_tabs(created_at);
