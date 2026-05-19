-- 007_editor_tabs_plan_diff.sql
-- Sprint 11 — widen the `kind` CHECK on editor_tabs to allow 'plan-diff'.
--
-- SQLite cannot ALTER a CHECK constraint in place. Standard workaround:
-- build a copy table with the new constraint, copy rows, drop the original,
-- and rename. Indexes and FKs are recreated to mirror the original schema.

PRAGMA foreign_keys=OFF;

CREATE TABLE editor_tabs__new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK(kind IN ('editor', 'object', 'plan-diff')),
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

INSERT INTO editor_tabs__new
  (id, kind, name, content, connection_id, node_key,
   cursor_line, cursor_col, created_at, updated_at)
SELECT
   id, kind, name, content, connection_id, node_key,
   cursor_line, cursor_col, created_at, updated_at
FROM editor_tabs;

DROP TABLE editor_tabs;
ALTER TABLE editor_tabs__new RENAME TO editor_tabs;

CREATE INDEX IF NOT EXISTS editor_tabs_created_at_idx ON editor_tabs(created_at);

PRAGMA foreign_keys=ON;
