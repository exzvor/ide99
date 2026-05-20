# Changelog

All notable changes to **ide99** are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.3] — 2026-05-20

Small UI polish on top of v1.0.2.

- **Instant DB beta endpoint repaired.** The hard-coded dev fallback in `src-tauri/src/instant_db/config.rs` pointed to a stale IP (`46.21.247.85`) that no longer routed to the beta VM, surfacing as `Failed to create Instant DB: network error` whenever DNS for `instant.ide99.ru` / `instant.ide99.io` was missing. The canonical HTTPS hosts now resolve (DNS A-records + Let's Encrypt certs live on the beta VM); the dev fallback was retargeted to the current VM address as a safety net.
- **Error-explanation modal no longer clips against the modal edges.** `.q-modal.lg` left header and footer flush against the rounded corners, and `.error-explain-body` had no padding/typography styles at all — so the title, the SQLSTATE subtitle, and the `Close` button all sat at the modal border. Added proper insets for the `lg` variant header/footer + a full set of body styles (sectioned layout, monospace `<pre>` block, accent-aware spacing), plus a corner `×` close button on the modal itself.
- **Toast notifications now have a manual close `×`.** Top-right toasts auto-dismissed on a timer with no way to close them sooner; added a `RadixToast.Close` button with an `X` icon to every toast (sits next to the optional action button if present).

## [1.0.2] — 2026-05-15

Bug-fix patch on top of v1.0.1.

- **Crash reporter showed stale "0.1.0" app version.** The `VITE_APP_VERSION` env var was never injected at build time, so `CrashReporterHost.tsx` fell back to its hard-coded "0.1.0" default. Fixed in `vite.config.ts` by reading `package.json#version` and exposing it via `define`. The reporter now matches the actual build.

## [1.0.1] — 2026-05-15

Distribution-only patch. No application code changes.

- **macOS `.pkg` artefact.** New `ide99_${VERSION}_${arch}.pkg` whose postinstall strips `com.apple.quarantine` and re-applies the ad-hoc signature on the installed bundle. Eliminates per-launch Gatekeeper warnings that the `.dmg` path was hitting under ad-hoc signing.
- **Windows portable `.zip` artefact.** New `ide99_${VERSION}_x64-portable.zip` containing the bare Tauri binary. Dodges browser-level download reputation gates that hide the NSIS `.exe` outright.

## [1.0.0] — 2026-05-07

First public release.

### Highlights

- Tauri 2.0 + Rust core with React/TypeScript frontend
- Connection manager with credential keychain, environment labels, safety guards
- SQL editor (Monaco) with multi-tab persistence, PostgreSQL-aware autocomplete, snippets
- Schema browser
- Streaming query execution with cursor-based pagination
- Query history (search, pin, tag, comment, export)
- Virtualized result grid with filtering, sorting, JSONB cell editor
- Bidirectional GUI ↔ SQL (filters / sort propagate to the query)
- EXPLAIN visualizer (pev2 embed) with cancel + cost/rows insights, plan diff
- PostgreSQL Health Screen with one-click fixes
- Live Ops Dashboard with blocking-chain DAG
- JSONB tree editor with path autocomplete + schema inference
- ERD diagram (React Flow) + visual schema editor
- Native migration workflow (apply / rollback / dry-run / Squawk lint)
- Object editors — table, view, matview, index, sequence, function, procedure, trigger, FDW, publication, subscription, role, custom types
- Extension power-packs — pgvector, PostGIS, TimescaleDB, pg_partman, pg_stat_statements, pg_repack
- MCP server (ide99 exposes tools/resources to external AI agents) + outbound MCP client
- Plain-English error explanation with SQLSTATE mappings
- Easy mode — mode toggle, concept tooltips, common-mistakes linter, onboarding tour
- Notebook Mode (Jupyter-style for SQL with CTE composition and Markdown variable substitution; `.ide99nb` file format)
- Backup / Restore wizard (`pg_dump` / `pg_restore` / `pg_basebackup` with progress and scheduling)
- i18n RU + EN (native quality)
- Accessibility — WCAG 2.1 AA baseline, high-contrast theme, ERD keyboard navigation, Cyrillic identifier handling
- Keymap import (VS Code / DataGrip / DBeaver)
- Telemetry + crash reports (opt-in only, with event allowlist and path redaction)
- `.ide99` file-based sharing (credentials never cross the file)
- Auto-updater (Tauri plugin) with stable / beta / nightly channels

[Unreleased]: https://github.com/exzvor/ide99/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/exzvor/ide99/releases/tag/v1.0.2
[1.0.1]: https://github.com/exzvor/ide99/releases/tag/v1.0.1
[1.0.0]: https://github.com/exzvor/ide99/releases/tag/v1.0.0
