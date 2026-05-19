-- Sprint 37 — release-channel + paid-modules state extension to app_settings.
--
-- ALTER on the existing singleton row (id = 1) instead of a new table —
-- mirrors S36 design. New columns:
--   * `release_channel` — stable | beta | nightly. Drives the auto-updater
--     manifest URL; default `stable`.
--   * `last_update_check_at` — RFC3339 timestamp of the last
--     `updater_check` call. UI shows "Last checked: 5 min ago".
--   * `spg99_subscribed` / `vibepg_subscribed` — explicit subscription flags
--     for paid-module UI gates. Default OFF; module manager flips them when
--     the user signs in (S37 Phase A scaffold; real OAuth wires later).
ALTER TABLE app_settings ADD COLUMN release_channel TEXT NOT NULL DEFAULT 'stable';
ALTER TABLE app_settings ADD COLUMN last_update_check_at TEXT;
ALTER TABLE app_settings ADD COLUMN spg99_subscribed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN vibepg_subscribed INTEGER NOT NULL DEFAULT 0;
