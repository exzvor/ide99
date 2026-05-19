-- Sprint 36 — singleton app_settings row.
--
-- Holds privacy + onboarding flags previously implicit in localStorage.
-- Single-row design via `id INTEGER PRIMARY KEY CHECK (id = 1)` mirrors the
-- VS Code-style "settings.json singleton" pattern; UPSERT is `INSERT OR
-- REPLACE` against id=1.
--
-- Telemetry / crash flags default OFF (opt-in semantics, см.
-- docs/engineering/08-privacy-and-telemetry.md §1).
--
-- `device_uuid` — anonymous identifier sent с telemetry events (NEVER
-- linked to PII). Generated once at first opt-in; cleared by
-- "Clear my data" Settings action.
CREATE TABLE IF NOT EXISTS app_settings (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    telemetry_enabled        INTEGER NOT NULL DEFAULT 0,
    crash_reports_enabled    INTEGER NOT NULL DEFAULT 0,
    telemetry_endpoint       TEXT NOT NULL DEFAULT 'eu',
    device_uuid              TEXT,
    onboarding_completed     INTEGER NOT NULL DEFAULT 0,
    privacy_choice_made      INTEGER NOT NULL DEFAULT 0,
    privacy_choice_made_at   TEXT,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (id, created_at, updated_at)
    VALUES (1, datetime('now'), datetime('now'));
