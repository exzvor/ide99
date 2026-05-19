-- 004_user_snippets.sql
-- Sprint 8: user-managed SQL snippets, complements built-in snippets that ship in TS.

CREATE TABLE user_snippets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT    NOT NULL,
  prefix        TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  documentation TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Prefix is intentionally NOT UNIQUE — users may have several snippets sharing
-- prefixes (e.g. "sel" personal vs "sel" project-specific). Palette filtering
-- surfaces both; built-in collisions also remain visible (user wins on insert).
CREATE INDEX idx_user_snippets_prefix ON user_snippets(prefix);
