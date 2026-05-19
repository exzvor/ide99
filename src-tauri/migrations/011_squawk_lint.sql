-- 011_squawk_lint.sql
-- Sprint 22: per-connection toggle for Squawk lint integration.
-- Default ON; auto-disabled at runtime if Squawk binary is missing on PATH.

ALTER TABLE connections ADD COLUMN squawk_lint_enabled INTEGER NOT NULL DEFAULT 1;
