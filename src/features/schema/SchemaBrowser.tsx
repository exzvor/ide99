import { Gauge, GitBranch, Loader2, Network, Plus, RefreshCw } from "lucide-react";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { localizeConnectionError } from "../../lib/errors";
import { ConnectionError } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { useEditor } from "../editor/store";
import { JsonbQueryBuilderModal } from "../jsonb/builder";
import { SuggesterModal } from "../jsonb/suggester";
import {
  PgPartmanTablePanel,
  isPgPartmanInstalled,
  loadPgPartmanParents,
  usePgPartman,
} from "../pgpartman";
import { PgRepackTablePanel, isPgRepackInstalled } from "../pgrepack";
import { isPgStatStatementsInstalled } from "../pgstatstatements";
import { PgvectorTablePanel, detectVectorColumns, isPgvectorInstalled } from "../pgvector";
import { PostgisTablePanel, detectGeometryColumns, isPostgisInstalled } from "../postgis";
import {
  TimescaleTablePanel,
  isTimescaleInstalled,
  loadHypertables,
  useTimescale,
} from "../timescale";
import { EmptyState } from "./EmptyState";
import { SchemaTree } from "./SchemaTree";
import { useSchema } from "./store";

/**
 * S26 — Parse a `table:schema/name` selection key. Returns null for any
 * selection that isn't a leaf table.
 */
function parseTableNodeKey(key: string | null): { schema: string; table: string } | null {
  if (key === null) return null;
  const sep = key.indexOf(":");
  if (sep === -1 || key.slice(0, sep) !== "table") return null;
  const rest = key.slice(sep + 1);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { schema: rest.slice(0, slash), table: rest.slice(slash + 1) };
}

/**
 * derive the schema name from the currently-selected tree node,
 * or fall back to "public" (the conventional default schema). Used by the
 * "+ New" toolbar dropdown when the user hasn't picked a specific node.
 */
function inferSchemaForNew(selectedNode: string | null): string {
  if (selectedNode === null) return "public";
  const sep = selectedNode.indexOf(":");
  if (sep === -1) return "public";
  const prefix = selectedNode.slice(0, sep);
  const rest = selectedNode.slice(sep + 1);
  if (prefix === "schema") return rest;
  // table:schema/name → schema is the part before the first slash.
  const slash = rest.indexOf("/");
  if (slash === -1) return "public";
  return rest.slice(0, slash);
}

type ColumnFqn = { schema: string; table: string; column: string };

/**
 * Right-sidebar shell that branches on `useSchema.connection.status`
 * (spec §5.2 / §7.7):
 *
 * - idle       → idle EmptyState
 * - connecting → spinner + "Loading schema…"
 * - error      → error EmptyState with Retry → re-invokes connect()
 * - connected  → header (refresh + search) + <SchemaTree />
 *
 * Cmd+R / Ctrl+R while focus is inside the sidebar triggers `refreshAll()`
 * (spec §5.6).
 */
export function SchemaBrowser(): JSX.Element {
  const { t } = useTranslation();
  const connection = useSchema((s) => s.connection);
  const filter = useSchema((s) => s.filter);
  const setFilter = useSchema((s) => s.setFilter);
  const refreshAll = useSchema((s) => s.refreshAll);
  const connect = useSchema((s) => s.connect);
  const loadAllForSearch = useSchema((s) => s.loadAllForSearch);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // — modal state for the Builder + Suggester entry points wired
  // through SchemaTree's context-menu callbacks. Sub-agents A and C replace
  // the placeholder modals' bodies during Phase 2; this scaffolding is what
  // lets each modal open from any JSONB column's right-click menu.
  const [builderFqn, setBuilderFqn] = useState<ColumnFqn | null>(null);
  const [suggesterFqn, setSuggesterFqn] = useState<ColumnFqn | null>(null);
  // "+ New" toolbar dropdown.
  const [newDropdownOpen, setNewDropdownOpen] = useState(false);
  // collapse 4 Type variants under a single "Type" entry.
  // When this is true, the dropdown shows the 4 type sub-items page.
  const [typeSubmenuOpen, setTypeSubmenuOpen] = useState(false);
  const newDropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedNode = useSchema((s) => s.selectedNode);
  const cache = useSchema((s) => s.cache);
  const connId = connection.status === "connected" ? connection.connId : "";

  // S26 — derive pgvector panel inputs from the currently-selected table node.
  const selectedTable = useMemo(() => parseTableNodeKey(selectedNode), [selectedNode]);
  const tableColumns = useMemo(() => {
    if (selectedTable === null) return [] as { name: string; typeName: string }[];
    const cached = cache.get(`table:${selectedTable.schema}/${selectedTable.table}`);
    if (!cached) return [];
    return cached
      .filter((c) => c.kind === "column")
      .map((c) => ({ name: c.name, typeName: c.dataType ?? "" }));
  }, [cache, selectedTable]);
  const detected = useMemo(() => detectVectorColumns(tableColumns), [tableColumns]);
  const textCols = useMemo(
    () =>
      tableColumns
        .filter((c) => /^(text|varchar|char|citext|tsvector)/i.test(c.typeName))
        .map((c) => c.name),
    [tableColumns],
  );
  const [pgvectorAvailable, setPgvectorAvailable] = useState<boolean>(false);
  useEffect(() => {
    if (connection.status !== "connected") return;
    let cancelled = false;
    void isPgvectorInstalled(connection.connId).then((ok) => {
      if (!cancelled) setPgvectorAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // S27 — PostGIS extension probe (mirrors pgvector pattern).
  const detectedGeom = useMemo(() => detectGeometryColumns(tableColumns), [tableColumns]);
  const [postgisAvailable, setPostgisAvailable] = useState<boolean>(false);
  useEffect(() => {
    if (connection.status !== "connected") return;
    let cancelled = false;
    void isPostgisInstalled(connection.connId).then((ok) => {
      if (!cancelled) setPostgisAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // S28 — TimescaleDB extension probe + bulk-load hypertable registry.
  const [timescaleAvailable, setTimescaleAvailable] = useState<boolean>(false);
  useEffect(() => {
    if (connection.status !== "connected") return;
    let cancelled = false;
    void isTimescaleInstalled(connection.connId).then((ok) => {
      if (cancelled) return;
      setTimescaleAvailable(ok);
      if (ok) {
        void loadHypertables(connection.connId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);
  const tsRecord = useTimescale((s) => {
    if (!selectedTable || connection.status !== "connected") return null;
    return (
      s.hypertables.get(connection.connId)?.get(`${selectedTable.schema}/${selectedTable.table}`) ??
      null
    );
  });

  // S29 — pg_partman extension probe + bulk-load parents registry.
  const [pgPartmanAvailable, setPgPartmanAvailable] = useState<boolean>(false);
  useEffect(() => {
    if (connection.status !== "connected") return;
    let cancelled = false;
    void isPgPartmanInstalled(connection.connId).then((ok) => {
      if (cancelled) return;
      setPgPartmanAvailable(ok);
      if (ok) {
        void loadPgPartmanParents(connection.connId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);
  const partmanInfo = usePgPartman((s) => {
    if (!selectedTable || connection.status !== "connected") return null;
    return (
      s.parents.get(connection.connId)?.get(`${selectedTable.schema}/${selectedTable.table}`) ??
      null
    );
  });

  // S29 — pg_repack extension probe.
  const [pgRepackAvailable, setPgRepackAvailable] = useState<boolean>(false);
  useEffect(() => {
    if (connection.status !== "connected") return;
    let cancelled = false;
    void isPgRepackInstalled(connection.connId).then((ok) => {
      if (!cancelled) setPgRepackAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // S29 — pg_stat_statements extension probe.
  const [pgssAvailable, setPgssAvailable] = useState<boolean>(false);
  useEffect(() => {
    if (connection.status !== "connected") return;
    let cancelled = false;
    void isPgStatStatementsInstalled(connection.connId).then((ok) => {
      if (!cancelled) setPgssAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // Close "+ New" dropdown on outside click or Escape.
  useEffect(() => {
    if (!newDropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (newDropdownRef.current && target && !newDropdownRef.current.contains(target)) {
        setNewDropdownOpen(false);
        setTypeSubmenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (typeSubmenuOpen) {
          setTypeSubmenuOpen(false);
        } else {
          setNewDropdownOpen(false);
        }
      }
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [newDropdownOpen, typeSubmenuOpen]);

  const openNewObjectEditor = (
    objectKind:
      | "table"
      | "view"
      | "matview"
      | "index"
      | "sequence"
      | "function"
      | "procedure"
      | "trigger"
      | "fdw_server"
      | "publication"
      | "subscription"
      | "role"
      | "enum_type"
      | "composite_type"
      | "domain_type"
      | "range_type",
  ): void => {
    if (connection.status !== "connected") return;
    const schema = inferSchemaForNew(selectedNode);
    setTypeSubmenuOpen(false);
    useEditor.getState().openObjectEditor({
      connectionId: connection.connId,
      objectKind,
      mode: "create",
      schema,
    });
    setNewDropdownOpen(false);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      // Trigger refresh only when focus is somewhere inside the sidebar,
      // so the same hotkey can be reused elsewhere (e.g. result grid).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        if (el.contains(document.activeElement)) {
          e.preventDefault();
          void refreshAll();
        }
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [refreshAll]);

  // First time the user types into the search box, eagerly load every
  // schema's tables/views so the filter has a complete index to match
  // against. Without this the search only sees nodes the user manually
  // expanded, which is 's "tables exist but search returns empty".
  // `loadAllForSearch` short-circuits on subsequent calls (each per-key
  // fetch hits the cache), so leaving this dep array as-is is safe.
  const hasPreloadedRef = useRef(false);
  useEffect(() => {
    if (filter && !hasPreloadedRef.current && connection.status === "connected") {
      hasPreloadedRef.current = true;
      void loadAllForSearch();
    }
    if (connection.status !== "connected") {
      hasPreloadedRef.current = false;
    }
  }, [filter, connection.status, loadAllForSearch]);

  const renderBody = (): JSX.Element => {
    switch (connection.status) {
      case "idle":
        return <EmptyState kind="idle" />;
      case "connecting":
        return (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "0 24px",
              textAlign: "center",
            }}
            data-testid="schema-connecting"
          >
            <Loader2
              size={28}
              aria-hidden="true"
              className="q-spin"
              style={{ color: "var(--ink-4)" }}
            />
            <p style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("schema.connecting")}</p>
          </div>
        );
      case "error": {
        const localized = connection.error
          ? localizeConnectionError(new ConnectionError(connection.error), t)
          : connection.message;
        // BUG-passwordMissing — when the backend tells us PG demanded a
        // password we don't have, retry would just loop. Surface a direct
        // "Open Edit" affordance and skip the Retry button.
        const isPasswordMissing = connection.error?.kind === "passwordMissing";
        return (
          <EmptyState
            kind="error"
            message={localized}
            onRetry={isPasswordMissing ? undefined : () => void connect(connection.connId)}
            primaryAction={
              isPasswordMissing
                ? {
                    label: t("connection.details.edit"),
                    onClick: () => useConnections.getState().openEditForm(connection.connId),
                  }
                : undefined
            }
          />
        );
      }
      case "connected":
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 10px 8px",
                borderBottom: "1px solid var(--hairline)",
              }}
              data-testid="schema-browser-header"
            >
              <button
                type="button"
                aria-label={t("schema.refresh")}
                title={t("schema.refresh")}
                onClick={() => void refreshAll()}
                className="btn-icon"
                style={{ width: 24, height: 24 }}
                data-testid="schema-refresh"
              >
                <RefreshCw size={13} aria-hidden="true" />
              </button>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("schema.search.placeholder")}
                aria-label={t("schema.search.placeholder")}
                className="q-input"
                style={{ flex: 1, height: 26, fontSize: 12, padding: "0 10px" }}
                data-testid="schema-search"
              />
              <button
                type="button"
                aria-label={t("erd.browser.open_button_aria")}
                title={t("erd.browser.open_button")}
                onClick={() => {
                  if (connection.status !== "connected") return;
                  useEditor.getState().openErdTab(connection.connId);
                }}
                className="btn-icon"
                style={{ width: 24, height: 24 }}
                data-testid="schema-erd-open"
              >
                <Network size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("migrations.browser.open_button_aria")}
                title={t("migrations.browser.open_button")}
                onClick={() => {
                  if (connection.status !== "connected") return;
                  useEditor.getState().openMigrationsTab(connection.connId);
                }}
                className="btn-icon"
                style={{ width: 24, height: 24 }}
                data-testid="schema-migrations-open"
              >
                <GitBranch size={13} aria-hidden="true" />
              </button>
              {pgssAvailable ? (
                <button
                  type="button"
                  aria-label={t("schema.browser.open_pgss")}
                  title={t("schema.browser.pgss_title")}
                  onClick={() => {
                    if (connection.status !== "connected") return;
                    useEditor.getState().openPgStatStatementsTab(connection.connId);
                  }}
                  className="btn-icon"
                  style={{ width: 24, height: 24 }}
                  data-testid="schema-pgss-open"
                >
                  <Gauge size={13} aria-hidden="true" />
                </button>
              ) : null}
              {/* — "+ New" object-editor dropdown. */}
              <div ref={newDropdownRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  aria-label={t("object_editor.toolbar.new_dropdown")}
                  aria-expanded={newDropdownOpen}
                  aria-haspopup="menu"
                  title={t("object_editor.toolbar.new_dropdown")}
                  onClick={() => setNewDropdownOpen((s) => !s)}
                  className="btn-icon"
                  style={{ width: 24, height: 24 }}
                  data-testid="schema-new-dropdown-toggle"
                >
                  <Plus size={13} aria-hidden="true" />
                </button>
                {newDropdownOpen && !typeSubmenuOpen ? (
                  <div
                    role="menu"
                    aria-label={t("object_editor.toolbar.new_dropdown")}
                    data-testid="schema-new-dropdown"
                    className="q-popover"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      zIndex: 60,
                      minWidth: 200,
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-table"
                      onClick={() => openNewObjectEditor("table")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_table")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-view"
                      onClick={() => openNewObjectEditor("view")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_view")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-matview"
                      onClick={() => openNewObjectEditor("matview")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_matview")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-index"
                      onClick={() => openNewObjectEditor("index")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_index")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-sequence"
                      onClick={() => openNewObjectEditor("sequence")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_sequence")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-function"
                      onClick={() => openNewObjectEditor("function")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_function")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-procedure"
                      onClick={() => openNewObjectEditor("procedure")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_procedure")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-trigger"
                      onClick={() => openNewObjectEditor("trigger")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_trigger")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-fdw-server"
                      onClick={() => openNewObjectEditor("fdw_server")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_fdw_server")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-publication"
                      onClick={() => openNewObjectEditor("publication")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_publication")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-subscription"
                      onClick={() => openNewObjectEditor("subscription")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_subscription")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-role"
                      onClick={() => openNewObjectEditor("role")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_role")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-type"
                      aria-haspopup="menu"
                      aria-expanded={typeSubmenuOpen}
                      onClick={() => setTypeSubmenuOpen(true)}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_type")} ▸
                    </button>
                  </div>
                ) : null}
                {newDropdownOpen && typeSubmenuOpen ? (
                  <div
                    role="menu"
                    aria-label={t("object_editor.toolbar.new_type")}
                    data-testid="schema-new-type-submenu"
                    className="q-popover"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      zIndex: 60,
                      minWidth: 200,
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-type-back"
                      onClick={() => setTypeSubmenuOpen(false)}
                      className="q-popover-item"
                      style={{ fontStyle: "italic" }}
                    >
                      ◂ {t("object_editor.toolbar.back")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-enum-type"
                      onClick={() => openNewObjectEditor("enum_type")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_enum_type")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-composite-type"
                      onClick={() => openNewObjectEditor("composite_type")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_composite_type")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-domain-type"
                      onClick={() => openNewObjectEditor("domain_type")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_domain_type")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-new-range-type"
                      onClick={() => openNewObjectEditor("range_type")}
                      className="q-popover-item"
                    >
                      {t("object_editor.toolbar.new_range_type")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
              <SchemaTree
                onOpenBuilder={(fqn) => setBuilderFqn(fqn)}
                onOpenSuggester={(fqn) => setSuggesterFqn(fqn)}
              />
            </div>
            {pgvectorAvailable && selectedTable !== null && detected.vectorColumns.length > 0 ? (
              <div style={{ borderTop: "1px solid var(--hairline)", padding: 8 }}>
                <PgvectorTablePanel
                  connId={connId}
                  qualifiedTable={`"${selectedTable.schema}"."${selectedTable.table}"`}
                  pk={null}
                  vectorColumns={detected.vectorColumns}
                  textColumns={textCols}
                  rowCount={0}
                />
              </div>
            ) : null}
            {postgisAvailable && selectedTable !== null && detectedGeom.length > 0 ? (
              <div style={{ borderTop: "1px solid var(--hairline)", padding: 8 }}>
                <PostgisTablePanel
                  connId={connId}
                  qualifiedTable={`"${selectedTable.schema}"."${selectedTable.table}"`}
                  pk={null}
                  geometryColumns={detectedGeom}
                  rowCount={0}
                />
              </div>
            ) : null}
            {timescaleAvailable && selectedTable !== null ? (
              <div style={{ borderTop: "1px solid var(--hairline)", padding: 8 }}>
                <TimescaleTablePanel
                  connId={connId}
                  schema={selectedTable.schema}
                  table={selectedTable.table}
                  qualifiedTable={`"${selectedTable.schema}"."${selectedTable.table}"`}
                  isHypertable={tsRecord?.isHypertable === true}
                  isContinuousAggregate={tsRecord?.isContinuousAggregate === true}
                  columns={tableColumns}
                />
              </div>
            ) : null}
            {pgPartmanAvailable && selectedTable !== null ? (
              <div style={{ borderTop: "1px solid var(--hairline)", padding: 8 }}>
                <PgPartmanTablePanel
                  connId={connId}
                  schema={selectedTable.schema}
                  table={selectedTable.table}
                  qualifiedTable={`"${selectedTable.schema}"."${selectedTable.table}"`}
                  isPartmanParent={partmanInfo !== null}
                  partmanInfo={partmanInfo}
                  columns={tableColumns}
                />
              </div>
            ) : null}
            {pgRepackAvailable && selectedTable !== null && connection.status === "connected" ? (
              <div style={{ borderTop: "1px solid var(--hairline)", padding: 8 }}>
                <PgRepackTablePanel
                  connId={connId}
                  database={connection.database}
                  schema={selectedTable.schema}
                  table={selectedTable.table}
                />
              </div>
            ) : null}
          </div>
        );
    }
  };

  return (
    <section
      ref={containerRef}
      aria-label={t("schema.browser_aria")}
      data-testid="schema-browser"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "transparent",
      }}
    >
      {renderBody()}
      <JsonbQueryBuilderModal
        open={builderFqn !== null}
        connId={connId}
        fqn={builderFqn ?? { schema: "", table: "", column: "" }}
        onClose={() => setBuilderFqn(null)}
      />
      <SuggesterModal
        open={suggesterFqn !== null}
        connId={connId}
        fqn={suggesterFqn ?? { schema: "", table: "", column: "" }}
        onClose={() => setSuggesterFqn(null)}
      />
    </section>
  );
}
