-- 003_query_history.sql
-- Sprint 6 — Query History (local SQLite + FTS5)

-- 1. Per-connection opt-out flag.
ALTER TABLE connections
  ADD COLUMN exclude_from_history INTEGER NOT NULL DEFAULT 0
    CHECK (exclude_from_history IN (0, 1));

-- 2. Main history table.
CREATE TABLE query_history (
  id              TEXT PRIMARY KEY,
  connection_id   TEXT NOT NULL,
  connection_name TEXT NOT NULL,
  sql             TEXT NOT NULL,
  executed_at     TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
  rows_affected   INTEGER,
  rows_returned   INTEGER,
  truncated       INTEGER NOT NULL DEFAULT 0
                  CHECK (truncated IN (0, 1)),
  error_message   TEXT,
  tag             TEXT,
  comment         TEXT,
  pinned          INTEGER NOT NULL DEFAULT 0
                  CHECK (pinned IN (0, 1))
) STRICT;

-- 3. Indexes for filter-paths.
CREATE INDEX idx_query_history_executed_at        ON query_history(executed_at DESC);
CREATE INDEX idx_query_history_connection_time    ON query_history(connection_id, executed_at DESC);
CREATE INDEX idx_query_history_pinned             ON query_history(pinned, executed_at DESC)
  WHERE pinned = 1;

-- 4. FTS5 external-content index.
CREATE VIRTUAL TABLE query_history_fts USING fts5(
  sql,
  content='query_history',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- 5. Sync triggers.
CREATE TRIGGER query_history_ai AFTER INSERT ON query_history BEGIN
  INSERT INTO query_history_fts(rowid, sql) VALUES (new.rowid, new.sql);
END;

CREATE TRIGGER query_history_ad AFTER DELETE ON query_history BEGIN
  INSERT INTO query_history_fts(query_history_fts, rowid, sql)
    VALUES ('delete', old.rowid, old.sql);
END;

CREATE TRIGGER query_history_au AFTER UPDATE ON query_history BEGIN
  INSERT INTO query_history_fts(query_history_fts, rowid, sql)
    VALUES ('delete', old.rowid, old.sql);
  INSERT INTO query_history_fts(rowid, sql) VALUES (new.rowid, new.sql);
END;
