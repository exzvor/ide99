-- 010_migration_settings.sql
-- Sprint 21: per-connection migration settings.
-- migrations_dir              : optional filesystem path to .sql migration files
-- migration_tracking_enabled  : toggle for ide99_migrations ledger (default ON)
-- migration_snapshots_enabled : toggle for capturing schema snapshots (default OFF)

ALTER TABLE connections ADD COLUMN migrations_dir              TEXT;
ALTER TABLE connections ADD COLUMN migration_tracking_enabled  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE connections ADD COLUMN migration_snapshots_enabled INTEGER NOT NULL DEFAULT 0;
