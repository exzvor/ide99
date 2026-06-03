# Changelog

All notable changes to **ide99** are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.7] — 2026-06-03

Reliability + closed-network release: crash logging, real keychains, calmer idle, single titlebar, offline installer.

- **Crashes are now diagnosable and survivable (#14).** A native Rust panic used to kill the whole app instantly with no trace — no crash report, no log files. Now panics (and all errors) are written to rotating logs under `<data_dir>/logs/` (`~/.local/share/io.ide99.app/logs/` on Linux), with secrets redacted, via a panic hook that flushes before the process aborts. On the UI side a React error boundary stops a failing tab from blanking the entire window, and uncaught errors/rejections are mirrored to the local log even when crash reporting is turned off.
- **PostgreSQL 9.6 compatibility (#14).** On old servers (e.g. Astra Linux ships 9.6) the function / procedure / sequence / table introspection queries referenced catalog columns that don't exist before PG 10/11 (`prokind`, `pg_sequences`, `pg_partitioned_table`, identity/generated columns), which surfaced as an "Unhandled rejection" on connect and missing objects in the browser. Version-gated query variants now list those objects correctly on 9.6+.
- **Saved connection passwords persist (#25).** The `keyring` dependency was built with no backend feature, so every 1.0.x build silently used an in-memory mock and lost passwords on restart — on **all** platforms. Real OS backends are now enabled per-OS (macOS Keychain, Windows Credential Manager, Linux Secret Service). A startup write/read probe rejects the mock; when no OS keychain exists (e.g. a headless server) passwords are kept in a local `0600` file instead, and a one-time warning makes that visible rather than silent.
- **Lower idle CPU on the Welcome/Workspace screens (#11).** The background node mesh ran an uncapped animation loop with O(n²) link work, and the blurred backdrop used an expensive 80px blur. The canvas is now capped at 30fps and paused when the window is hidden or a modal is open, with fewer nodes and a lighter blur (disabled entirely under reduced-motion). Idle CPU drops from near-100% to a few percent.
- **One titlebar, and Toggle Theme works (#12).** On Windows/Linux the app drew its own titlebar on top of the native one (a double titlebar) — the custom bar is now shown only on macOS. The **View → Toggle Theme** menu item, previously a silent no-op, now cycles the theme.
- **Calm update check on closed networks (#16).** While the updater isn't deployed yet, "Check for updates" returns instantly with "not enabled in this build" instead of an 8-second timeout that read like a server outage.
- **Windows offline installer (#17).** A new `ide99_<version>_x64-offline-setup.exe` embeds the WebView2 runtime so it installs with no internet (closed-contour); the small online installer stays the default download.
- **Health severity is readable (reported via Habr).** The corner badge used the same circle-`!` glyph for warning and critical, differing only by colour (indistinguishable in the light theme). Warnings now use a triangle, critical a circle, each with a screen-reader label.
- **PostGIS map works offline.** Leaflet's marker icons are bundled (they were broken even online), and the OpenStreetMap basemap is skipped when offline so geometries render on a neutral background instead of broken tiles.

## [1.0.6] — 2026-06-02

Offline editor fix + more of the schema tree + Health dashboard interactivity.

- **SQL editor works offline (#32).** The editor (Monaco) was fetched from a CDN at runtime, so on offline / air-gapped / proxied machines it hung on "Loading…" forever (and the SQL console appeared to be missing). Monaco and its workers are now bundled into the app — no network needed. Reported via Habr.
- **Functions & procedures in the schema tree (#33).** Each schema now has **Functions** and **Procedures** groups alongside Tables / Views / Materialized views, with a definition view on selection. Overloaded routines (same name, different argument signatures) appear as distinct entries.
- **Health dashboard is interactive (#34).** The "+N more" indicator on the Table-bloat card now expands the list in place, and the header **critical / warning** pills are clickable — they scroll to and briefly highlight the first card of that severity. Reported via Habr.

## [1.0.5] — 2026-06-02

Schema-browser + connection-form improvements and a data-dir fix.

- **Materialized views are shown in the schema tree (#27).** Each schema now has a **Materialized views** group alongside Tables and Views; selecting a matview shows its definition (with a note when it is unpopulated). Existing matviews were always intact — they were just missing the tree node. Reported via support.
- **Browse available databases in the connection form (#24).** A **Browse databases** button next to the Database field lists the databases the entered credentials can reach (it connects to a maintenance DB, so it works even if the typed database name is wrong) and feeds them to a type-ahead `<datalist>`.
- **Data directory uses a product-specific folder on every platform (#26).** Linux/Windows stored data in a generic `app` folder (`~/.local/share/app`); it now resolves to `io.ide99.app`, matching macOS. A one-time, best-effort startup migration moves existing v1.0.x data to the new location, so saved connections are preserved.

## [1.0.4] — 2026-06-01

Bug-fix release addressing reported v1.0.3 issues.

- **Environment dropdown is selectable in the connection form (#13).** `.env-select-content` rendered at `z-index: 80`, below the host `.q-modal` (90), so its options painted behind the modal and were not clickable with the mouse (keyboard selection still worked). Both mount as `document.body`-level Radix portals; raised the panel to 95 so it stacks above the modal.
- **Save enables on non-connectivity setting changes (#15).** Changing Environment, name, or the safety/history toggles now enables Save without requiring a connection test. Connectivity fields (host/port/database/username/password/SSL) still require a successful test or the explicit "save without testing" opt-in.
- **`--version` / `--help` work without launching the GUI (#10).** The binary prints version/usage and exits for `--version`/`-V`/`--help`/`-h`; unrecognized args (including macOS launch args and file paths) fall through to a normal launch. Windows GUI-subsystem console output is a tracked follow-up.
- **Help → About opens a real dialog (#12, partial).** The About item now shows a native dialog with name/version/identifier instead of only writing a log line. The Linux native-menu vs custom-titlebar frame conflict is tracked separately.
- **Calmer "check for updates" failure (#16, partial).** An unreachable/unconfigured updater no longer surfaces a raw resolver/DNS error string; a localized message is shown instead. End-to-end update checking still requires the updater infrastructure (DNS/TLS/CDN + signing key), tracked separately.
- **Crash-report send feedback (#14, partial).** "Send report" now shows a success / "not configured" / error toast instead of closing silently; the backend distinguishes a missing DSN from a real send. The underlying connect-crash diagnosis (file logging + repro) is tracked separately.

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
