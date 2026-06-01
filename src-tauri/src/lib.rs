//! ide99 Tauri shell entry point.
//!
//! Wires up tracing, the `SQLite` store + keychain + pool registry, the native
//! menu, the `log_error` IPC command, and the "READY" handshake the criterion
//! `cold_start` bench depends on.

pub mod admin_telemetry;
mod app_paths;
pub mod backup;
pub mod cli;
pub mod connection;
pub mod file_sharing;
pub mod health;
pub mod instant_db;
pub mod lint;
pub mod live_ops;
mod logging;
pub mod mcp;
mod menu;
pub mod migrations;
pub mod modules;
pub mod notebook;
pub mod parser;
pub mod query;
pub mod schema;
pub mod snippets;
pub mod support;
pub mod system;
pub mod telemetry;
pub mod updater;

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{Manager, WindowEvent};
use tokio::sync::{Mutex, RwLock};

use crate::connection::{Keychain, PoolRegistry, Store};
use crate::query::cursor::CursorRegistry;

/// Shared application state. Held as Tauri-managed state so command handlers
/// can read/write the store, talk to the keychain, and re-use connection
/// pools across invocations.
pub struct AppState {
    pub store: Arc<Mutex<Store>>,
    pub keychain: Box<dyn Keychain>,
    pub pools: Arc<PoolRegistry>,
    pub cursors: Arc<CursorRegistry>,
    /// — maps `explain_tab_id` → backend pid of the in-flight
    /// EXPLAIN. Used by `query_explain_cancel` to issue
    /// `pg_cancel_backend(pid)` from a fresh pool client (the running
    /// client is busy executing EXPLAIN).
    pub explain_in_flight: Arc<RwLock<HashMap<String, i32>>>,
    /// — maps `action_id` → `(pid, kind)` for in-flight Health
    /// actions (REINDEX/VACUUM). `health_action_progress` reads this to
    /// know which pid to query in `pg_stat_progress_*`.
    pub action_registry: Arc<crate::health::actions::ActionRegistry>,
    /// — JSONB schema inference background-task in-flight map.
    pub inference_state: Arc<crate::query::jsonb::inference::InferenceState>,
    /// — per-connection filesystem watchers for migration directories.
    pub migration_watchers: crate::migrations::types::WatcherMap,
    /// per-connection cancellation senders for an
    /// in-flight `migrations_dryrun`. Sending on the oneshot tells the
    /// command to short-circuit; testcontainers `Drop` then cleans up the
    /// ephemeral container immediately when the user closes the dialog.
    pub dryrun_cancellers: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
    /// — IDE state snapshot для MCP-сервера. Frontend пушит
    /// сюда (debounced 300 ms) через `mcp_bridge_update`; MCP tools
    /// семейства `ide_state` читают.
    pub mcp_bridge: Arc<RwLock<crate::mcp::IdeBridgeState>>,
    /// — handle на запущенный MCP-сервер. В — disabled
    /// placeholder; заменит на реальные `JoinHandle`-ы транспортов.
    pub mcp_server: Arc<Mutex<crate::mcp::McpServerHandle>>,
    /// — registry of outbound MCP **client** connections to
    /// external servers (Linear, GitHub, …). Loaded from
    /// `~/.config/ide99/mcp-servers.json` on boot; auto-start runs in the
    /// background after the main window paints.
    pub mcp_client_registry: Arc<crate::mcp::ClientRegistry>,
    /// — base data directory (resolved via `app_paths::data_dir`).
    /// Used by `backup::schedule` to persist `backups/schedules.json` and
    /// future modules that need filesystem-side state outside SQLite.
    pub data_dir: PathBuf,
    /// — per-job cancellation senders for in-flight pg_dump /
    /// pg_restore / pg_basebackup subprocesses. fills bodies; the
    /// map-with-`Mutex` carries the contract.
    pub backup_jobs: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
}

impl AppState {
    /// Build a state instance against an explicit data dir + keychain backend.
    /// Kept public so integration tests can construct one without going
    /// through the Tauri runtime.
    pub fn new(store: Store, keychain: Box<dyn Keychain>, pools: Arc<PoolRegistry>) -> Self {
        Self::with_data_dir(store, keychain, pools, PathBuf::new())
    }

    /// Construct with explicit data dir — production builds use the resolved
    /// `app_paths::data_dir()`; integration tests pass a `tempdir`.
    pub fn with_data_dir(
        store: Store,
        keychain: Box<dyn Keychain>,
        pools: Arc<PoolRegistry>,
        data_dir: PathBuf,
    ) -> Self {
        Self {
            store: Arc::new(Mutex::new(store)),
            keychain,
            pools,
            cursors: CursorRegistry::new(),
            explain_in_flight: Arc::new(RwLock::new(HashMap::new())),
            action_registry: Arc::new(crate::health::actions::ActionRegistry::default()),
            inference_state: Arc::new(crate::query::jsonb::inference::InferenceState::new()),
            migration_watchers: Arc::new(RwLock::new(HashMap::new())),
            dryrun_cancellers: Arc::new(RwLock::new(HashMap::new())),
            mcp_bridge: Arc::new(RwLock::new(crate::mcp::IdeBridgeState::default())),
            mcp_server: Arc::new(Mutex::new(crate::mcp::McpServerHandle::disabled())),
            mcp_client_registry: Arc::new(crate::mcp::ClientRegistry::new()),
            data_dir,
            backup_jobs: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

/// Application bootstrap. Called from `main.rs`.
///
/// # Panics
///
/// Panics if the Tauri runtime fails to initialize, the bundled context is
/// invalid, the `main` window cannot be located, or persistent storage cannot
/// be opened — all of which indicate an unrecoverable misconfiguration.
#[allow(clippy::too_many_lines)] // generate_handler! list grows linearly with each sprint
pub fn run() {
    logging::init_tracing();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "ide99 starting");

    let data_dir_path = app_paths::data_dir().expect("data dir");
    let db_path = app_paths::store_db_path().expect("store db path");
    let mut store = Store::open(&db_path).expect("open store");
    store.run_migrations().expect("migrations");

    let state = AppState::with_data_dir(
        store,
        connection::keychain::pick(),
        Arc::new(PoolRegistry::new()),
        data_dir_path,
    );

    // Idle-cursor sweeper: every 60s, close any cursor whose last fetch
    // was over IDLE_TIMEOUT ago. Bounds the open-transaction window even
    // if the user walks away from a tab with a half-loaded result.
    let cursors_for_sweeper = state.cursors.clone();
    tauri::async_runtime::spawn(async move {
        // Pair `unknown_lints` so toolchains pre-Rust-1.95 (clippy 0.1.89)
        // don't error on the unknown `duration_suboptimal_units` name.
        #[allow(unknown_lints)]
        #[allow(clippy::duration_suboptimal_units)]
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            tick.tick().await;
            let drained = cursors_for_sweeper.drain_idle().await;
            for cs in drained {
                tracing::info!(
                    cursor_id = cs.cursor_id,
                    conn_id = cs.conn_id,
                    "idle cursor swept",
                );
                let _ = cs
                    .client
                    .batch_execute(&format!("CLOSE \"{}\"; ROLLBACK;", cs.cursor_id))
                    .await;
            }
            // also reap finished-cursor metadata that has been
            // idle past `IDLE_TIMEOUT`. Bounded by the same 30-min window
            // as open cursors so the side table doesn't grow unbounded.
            let n = cursors_for_sweeper.drain_idle_finished().await;
            if n > 0 {
                tracing::info!(swept = n, "idle finished-cursor metadata swept");
            }
        }
    });

    // — outbound MCP client auto-start. Loads
    // `~/.config/ide99/mcp-servers.json`, syncs the registry, fires
    // `connect()` on every entry whose `autoStart` is true. Runs in the
    // background so a slow / hung remote server can't block boot.
    let mcp_registry_for_autostart = state.mcp_client_registry.clone();
    tauri::async_runtime::spawn(async move {
        let cfg_path = match app_paths::mcp_servers_config_path() {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(error = %e, "mcp client config path unavailable; auto-start skipped");
                return;
            }
        };
        let cfg = match crate::mcp::client::config::McpClientConfig::load(&cfg_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e, "mcp-servers.json invalid; auto-start skipped");
                return;
            }
        };
        if let Err(e) = mcp_registry_for_autostart.sync_from_config(&cfg).await {
            tracing::warn!(error = %e, "mcp client registry sync failed");
            return;
        }
        let failures = mcp_registry_for_autostart.auto_start_all().await;
        for (name, err) in &failures {
            tracing::warn!(server = %name, error = %err, "mcp client auto-start failed");
        }
        tracing::info!(
            servers = cfg.mcp_servers.len(),
            failed = failures.len(),
            "mcp client auto-start complete"
        );
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // — auto-updater plugin. The plugin's runtime config is
        // read from `tauri.conf.json :: plugins.updater` (endpoints + pubkey).
        // Production builds replace the placeholder pubkey at signing time
        // (see `scripts/release.sh`). With `active = false` in the config
        // the plugin is a no-op until the v1.0 release script flips it.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            logging::log_error,
            system::open_external_url,
            connection::commands::list_connections,
            connection::commands::create_connection,
            connection::commands::duplicate_connection,
            connection::commands::update_connection,
            connection::commands::delete_connection,
            connection::commands::test_connection,
            connection::commands::test_connection_for_edit,
            connection::commands::test_saved_connection,
            connection::commands::parse_connection_uri,
            connection::commands::connection_connect,
            connection::commands::connection_disconnect,
            connection::commands::connection_set_exclude_from_history,
            connection::commands::connection_set_exclude_from_recent_plans,
            connection::commands::connection_set_environment,
            connection::commands::connection_set_read_only,
            connection::commands::connection_set_slow_query_warning,
            connection::commands::connection_set_confirm_destructive,
            connection::commands::connection_set_squawk_lint_enabled,
            connection::commands::connection_record_test_result,
            schema::commands::schema_list_schemas,
            schema::commands::schema_list_tables,
            schema::commands::schema_list_views,
            schema::commands::schema_list_columns,
            schema::commands::schema_list_indexes,
            schema::commands::schema_list_foreign_keys,
            schema::commands::schema_get_autocomplete_snapshot,
            // — object-editor introspection commands.
            schema::commands::schema_get_table_definition,
            schema::commands::schema_get_view_definition,
            schema::commands::schema_get_matview_definition,
            schema::commands::schema_get_index_definition,
            schema::commands::schema_get_sequence_definition,
            schema::commands::schema_list_matviews,
            schema::commands::schema_list_sequences,
            // — function/procedure/trigger introspection commands.
            schema::commands::schema_get_function_definition,
            schema::commands::schema_get_procedure_definition,
            schema::commands::schema_get_trigger_definition,
            schema::commands::schema_list_functions,
            schema::commands::schema_list_procedures,
            schema::commands::schema_list_triggers,
            // — FDW/Publication/Subscription/Role/Custom Type commands.
            schema::commands::schema_get_fdw_server_definition,
            schema::commands::schema_get_publication_definition,
            schema::commands::schema_get_subscription_definition,
            schema::commands::schema_get_role_definition,
            schema::commands::schema_get_custom_type_definition,
            schema::commands::schema_list_publishable_tables,
            schema::commands::schema_list_publications,
            schema::commands::schema_list_collations,
            schema::commands::schema_list_roles,
            schema::erd::erd_get_schema_graph,
            schema::apply_ddl::schema_apply_ddl,
            schema::positions::erd_save_positions,
            schema::positions::erd_load_positions,
            snippets::commands::snippets_list,
            snippets::commands::snippets_create,
            snippets::commands::snippets_update,
            snippets::commands::snippets_delete,
            snippets::commands::snippets_export,
            snippets::commands::snippets_import,
            query::commands::query_execute,
            query::commands::query_open_cursor,
            query::commands::query_run_batch,
            query::commands::query_fetch_page,
            query::commands::query_cancel,
            query::commands::query_close_cursor,
            query::commands::query_explain_cost,
            query::commands::query_explain,
            query::commands::query_explain_cancel,
            query::commands::recent_plans_save,
            query::commands::recent_plans_search,
            query::commands::recent_plans_get,
            query::commands::recent_plans_set_pinned,
            query::commands::recent_plans_delete,
            query::commands::recent_plans_clear_for_connection,
            query::commands::tabs_list,
            query::commands::tabs_save,
            query::commands::tabs_delete,
            query::commands::history_search,
            query::commands::history_set_pinned,
            query::commands::history_set_tag,
            query::commands::history_set_comment,
            query::commands::history_delete,
            query::commands::history_clear_for_connection,
            query::commands::history_export,
            query::commands::jsonb_resolve_row_key,
            query::commands::jsonb_save,
            query::jsonb::builder::commands::jsonb_builder_preview,
            query::commands::jsonb_inference_request,
            query::commands::jsonb_inference_invalidate,
            query::jsonb::suggester::commands::jsonb_suggester_hypothetical_explain,
            query::jsonb::suggester::commands::jsonb_suggester_run,
            health::commands::health_db_size,
            health::commands::health_bloat,
            health::commands::health_slow_queries,
            health::commands::health_missing_indexes,
            health::commands::health_unused_indexes,
            health::commands::health_cache_hit,
            health::commands::health_active_connections,
            health::commands::health_long_running,
            health::commands::health_vacuum_status,
            health::commands::health_replication_lag,
            health::commands::health_wal_throughput,
            health::commands::health_snapshots_save,
            health::commands::health_snapshots_recent,
            health::commands::health_action_reindex_table,
            health::commands::health_action_vacuum,
            health::commands::health_action_analyze,
            health::commands::health_action_drop_index,
            health::commands::health_action_kill_pid,
            health::commands::health_action_check_pid,
            health::commands::health_action_progress,
            live_ops::commands::live_ops_sessions,
            live_ops::commands::live_ops_slow,
            live_ops::commands::live_ops_replication,
            parser::commands::parser_parse_ddl,
            parser::commands::parser_parse_select,
            migrations::commands::migrations_set_dir,
            migrations::commands::migrations_clear_dir,
            migrations::commands::migrations_list,
            migrations::commands::migrations_apply,
            migrations::commands::migrations_rollback,
            migrations::commands::migrations_preview_up,
            migrations::commands::migrations_preview_down,
            migrations::commands::migrations_diff_snapshots,
            migrations::commands::migrations_set_options,
            migrations::dryrun::migrations_dryrun,
            migrations::dryrun::migrations_dryrun_cancel,
            lint::commands::lint_check_install,
            lint::commands::lint_list_rules,
            lint::commands::lint_file,
            // — MCP server (внешние AI-агенты: Claude Code, Cursor, ...).
            // — IPC-контракт зафиксирован, runtime-state добавляется
            // sub-agent rust-mcp-core в Phase B.
            mcp::commands::mcp_get_status,
            mcp::commands::mcp_set_enabled,
            mcp::commands::mcp_list_clients,
            mcp::commands::mcp_revoke_client,
            mcp::commands::mcp_get_config_snippet,
            mcp::commands::mcp_bridge_update,
            // Phase B/C — authorize + write-confirm flow + audit access.
            mcp::commands::mcp_authorize_response,
            mcp::commands::mcp_authorize_deny,
            mcp::commands::mcp_write_confirm_response,
            mcp::commands::mcp_get_audit_log,
            // — outbound MCP client (external servers) IPC surface.
            mcp::client::commands::mcp_client_list,
            mcp::client::commands::mcp_client_connect,
            mcp::client::commands::mcp_client_disconnect,
            mcp::client::commands::mcp_client_reload,
            mcp::client::commands::mcp_client_config_path,
            // — Notebook (Jupyter-style for SQL).
            notebook::commands::notebook_list,
            notebook::commands::notebook_get,
            notebook::commands::notebook_save,
            notebook::commands::notebook_delete,
            notebook::commands::notebook_count,
            notebook::commands::notebook_export_file,
            notebook::commands::notebook_export_file_minimal,
            notebook::commands::notebook_import_file,
            notebook::commands::notebook_compose_sql,
            notebook::commands::notebook_render_markdown,
            // — Telemetry / crash reports / app settings.
            telemetry::commands::settings_get,
            telemetry::commands::settings_set,
            telemetry::commands::settings_clear,
            telemetry::commands::telemetry_known_events,
            telemetry::commands::telemetry_send_event,
            telemetry::commands::crash_report_build,
            telemetry::commands::crash_report_send,
            // — paid-module subscription gate.
            modules::commands::modules_get_state,
            modules::commands::modules_pre_flight,
            // — auto-updater.
            updater::commands::updater_current_version,
            updater::commands::updater_manifest_url,
            updater::commands::updater_check,
            updater::commands::updater_install_pending,
            // instant-db (free beta) — spin up a remote test DB on the spg99
            // Instant Beta service. Replaces the retired bundled sample-db
            // loader (which only worked on the user's local machine and
            // required Docker). HMAC + per-device quota are server-enforced.
            instant_db::commands::instant_db_create,
            instant_db::commands::instant_db_status,
            instant_db::commands::instant_db_heartbeat,
            instant_db::commands::instant_db_delete,
            // in-app Support feedback — POST to the ide99-landing API which
            // forwards to the operator mailbox via Yandex Postbox.
            support::commands::support_send_feedback,
            // admin-side telemetry (Phase 5) — wedge metrics, separate
            // pipe from PostHog telemetry. Fire-and-forget POST to the
            // beta VM's /telemetry/v1/events endpoint.
            admin_telemetry::commands::admin_telemetry_emit,
            // — `.ide99` file-based sharing.
            file_sharing::commands::ide99_export_connection,
            file_sharing::commands::ide99_export_connection_bundle,
            file_sharing::commands::ide99_export_snippet,
            file_sharing::commands::ide99_export_snippet_bundle,
            file_sharing::commands::ide99_export_query,
            file_sharing::commands::ide99_export_notebook,
            file_sharing::commands::ide99_export_migration_set,
            file_sharing::commands::ide99_export_erd_layout,
            file_sharing::commands::ide99_export_theme,
            file_sharing::commands::ide99_export_keymap,
            file_sharing::commands::ide99_export_health_config,
            file_sharing::commands::ide99_preview_file,
            file_sharing::commands::ide99_import_file,
            file_sharing::commands::ide99_apply_snippet,
            file_sharing::commands::ide99_apply_snippet_bundle,
            file_sharing::commands::ide99_apply_query,
            file_sharing::commands::ide99_apply_notebook,
            file_sharing::commands::ide99_apply_migration_set,
            file_sharing::commands::ide99_apply_erd_layout,
            file_sharing::commands::ide99_apply_theme,
            file_sharing::commands::ide99_apply_keymap,
            file_sharing::commands::ide99_apply_health_config,
            // — Backup / Restore wizards + scheduling.
            backup::commands::backup_preview_command,
            backup::commands::restore_preview_command,
            backup::commands::basebackup_preview_command,
            backup::commands::backup_run,
            backup::commands::restore_run,
            backup::commands::basebackup_run,
            backup::commands::backup_cancel,
            backup::commands::schedule_list,
            backup::commands::schedule_upsert,
            backup::commands::schedule_remove,
            backup::commands::schedule_preview_cron_line,
            backup::commands::schedule_install,
            backup::commands::schedule_uninstall,
            backup::commands::schedule_run_now,
        ])
        .setup(|app| {
            // Install the menu before the window paints; menu events are routed below.
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(menu::handle_event);

            // The criterion `cold_start` bench reads "READY" from stdout to mark
            // first paint. We use the first `Focused(true)` `WindowEvent` as a
            // proxy for "window is visible and ready for input" — fires after
            // the WebView has rendered the initial frame on macOS, Windows,
            // and Linux. Documented in design spec §10.
            let main_window = app
                .get_webview_window("main")
                .expect("main window must exist");
            let printed = Arc::new(AtomicBool::new(false));
            main_window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Focused(true))
                    && !printed.swap(true, Ordering::SeqCst)
                {
                    println!("READY");
                    let _ = std::io::stdout().flush();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ide99");
}
