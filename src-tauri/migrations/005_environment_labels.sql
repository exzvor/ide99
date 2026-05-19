-- 005_environment_labels.sql
-- Sprint 8: per-connection env tag (local/dev/stage/prod) + 3 safety-guard
-- toggles. ALTER ... ADD COLUMN with DEFAULT backfills existing rows safely.

ALTER TABLE connections ADD COLUMN environment           TEXT    NOT NULL DEFAULT 'local';
ALTER TABLE connections ADD COLUMN read_only             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN slow_query_warning    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN confirm_destructive   INTEGER NOT NULL DEFAULT 0;
