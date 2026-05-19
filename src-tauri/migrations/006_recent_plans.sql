-- 006_recent_plans.sql
-- Sprint 10 — Recent EXPLAIN Plans (local SQLite + FTS5)

-- 1. Per-connection opt-out flag.
ALTER TABLE connections
  ADD COLUMN exclude_from_recent_plans INTEGER NOT NULL DEFAULT 0
    CHECK (exclude_from_recent_plans IN (0, 1));

-- 2. Main table.
CREATE TABLE recent_plans (
  id                   TEXT PRIMARY KEY,
  connection_id        TEXT NOT NULL,
  connection_name      TEXT NOT NULL,
  sql                  TEXT NOT NULL,
  plan_json            TEXT NOT NULL,
  executed_at          TEXT NOT NULL,
  duration_ms          INTEGER NOT NULL,
  total_cost           REAL,
  mode                 TEXT NOT NULL CHECK (mode IN ('explain', 'analyze')),
  options_json         TEXT NOT NULL,
  involved_tables_json TEXT NOT NULL DEFAULT '[]',
  pinned               INTEGER NOT NULL DEFAULT 0
                       CHECK (pinned IN (0, 1))
) STRICT;

-- 3. Indexes.
CREATE INDEX idx_recent_plans_executed_at      ON recent_plans(executed_at DESC);
CREATE INDEX idx_recent_plans_connection_time  ON recent_plans(connection_id, executed_at DESC);
CREATE INDEX idx_recent_plans_pinned           ON recent_plans(pinned, executed_at DESC) WHERE pinned = 1;
CREATE INDEX idx_recent_plans_total_cost       ON recent_plans(total_cost) WHERE total_cost IS NOT NULL;

-- 4. FTS5 external-content over sql.
CREATE VIRTUAL TABLE recent_plans_fts USING fts5(
  sql,
  content='recent_plans',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER recent_plans_ai AFTER INSERT ON recent_plans BEGIN
  INSERT INTO recent_plans_fts(rowid, sql) VALUES (new.rowid, new.sql);
END;

CREATE TRIGGER recent_plans_ad AFTER DELETE ON recent_plans BEGIN
  INSERT INTO recent_plans_fts(recent_plans_fts, rowid, sql) VALUES('delete', old.rowid, old.sql);
END;

CREATE TRIGGER recent_plans_au AFTER UPDATE OF sql ON recent_plans BEGIN
  INSERT INTO recent_plans_fts(recent_plans_fts, rowid, sql) VALUES('delete', old.rowid, old.sql);
  INSERT INTO recent_plans_fts(rowid, sql) VALUES (new.rowid, new.sql);
END;
