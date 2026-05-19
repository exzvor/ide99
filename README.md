# ide99

PostgreSQL IDE for developers. Cross-platform desktop application (macOS, Linux, Windows) with Russian and English UI, built on Tauri 2.0 + Rust core and a React/TypeScript frontend.

## Features

- **SQL editor** with PostgreSQL-aware autocomplete (CTEs, window functions, JSONB operators, `pg_catalog` awareness)
- **EXPLAIN visualizer** with tree view and plan diff (embedded `pev2`)
- **JSONB tree editor** with path autocomplete
- **PostgreSQL Health Screen** — bloat, slow queries, missing indexes, one-click fixes
- **Live Ops Dashboard** — active sessions, blocking chains (DAG visualization)
- **Virtualized result grid** — 50M+ rows at 60fps
- **ERD + Visual Schema Editor** with bidirectional GUI ↔ SQL
- **Native migrations** with Squawk lint
- **Object editors** — tables, views, materialized views, functions, procedures
- **Extension power-packs** — pgvector, PostGIS, TimescaleDB, pg_partman, pg_stat_statements, pg_repack
- **Backup / Restore** workflows
- **MCP server** — expose ide99 to AI agents (Claude Code, Cursor, Windsurf, Cline) for context-aware SQL assistance
- **Easy mode** — guided UX with plain-English error explanations, safe-mode by default

## Install

Prebuilt binaries are published on the [Releases](https://github.com/exzvor/ide99/releases) page for macOS, Linux and Windows.

Note: current builds are unsigned. First-launch instructions:

- **macOS**: open the `.pkg`, accept the one Gatekeeper warning. Subsequent launches are clean.
- **Windows**: download the `.zip`, extract and run the executable. Browser may flag the download (no signing certificate yet).
- **Linux**: `.AppImage` and `.deb` provided.

Documentation: [ide99.ru/docs](https://ide99.ru/docs/) (Russian) · [ide99.io/docs](https://ide99.io/docs/) (English).

## Build from source

Prerequisites: Node.js 20+, Rust stable, platform Tauri dependencies ([Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```bash
git clone https://github.com/exzvor/ide99.git
cd ide99
npm install
npm run tauri dev
```

Production build:

```bash
npm run tauri build
```

Output binaries land in `src-tauri/target/release/bundle/`.

## Connect an AI agent (MCP)

ide99 exposes an MCP server so external AI agents (Claude Code, Cursor, Windsurf, Cline) can read the active connection, the current query, and the last result — and propose SQL, EXPLAIN analyses, and safe read-only queries in context.

Enable: **Settings → AI / MCP → Enable MCP server**. The "Connect your agent" button generates the JSON snippet for `~/.claude/mcp_servers.json` or `~/.cursor/mcp.json`.

On first connect, each client passes an in-IDE authorize flow: pick a scope (`Allow`, `Allow read-only`, `Allow with write access`, `Deny`). Write operations (`run_query_write`, `apply_migration`) additionally require a per-call confirm with SQL preview. An audit log of all calls is at `<data_dir>/mcp-audit.log`.

## Stack

- **Tauri 2.0** — desktop shell
- **Rust** — backend (connection pool, schema introspection, query execution, MCP server)
- **React 18 + TypeScript** — frontend
- **Monaco** — SQL editor
- **pev2** — EXPLAIN visualizer
- **Zustand** — state management
- **Radix UI** + Tailwind v4 — primitives and styling
- **tokio-postgres** — Postgres driver

## License

[Apache License 2.0](./LICENSE).

## Security

To report a security issue, please follow the process in [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
