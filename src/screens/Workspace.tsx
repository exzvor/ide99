import { Plus, Radar, Settings } from "lucide-react";
import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { Mesh } from "../components/quiet/Mesh";
import { Titlebar } from "../components/quiet/Titlebar";
import { Wordmark } from "../components/quiet/Wordmark";
import { ConnectionDetails } from "../features/connections/ConnectionDetails";
import { ConnectionList } from "../features/connections/ConnectionList";
import { useConnections } from "../features/connections/store";
import { BidirectionalSqlPanel } from "../features/easy-mode/BidirectionalSqlPanel";
// Easy mode + restart-tour temporarily disabled — 
// import { EasyToggle } from "../features/easy-mode/EasyToggle";
import { BatchConfirmModal } from "../features/editor/BatchConfirmModal";
import { EditorPane } from "../features/editor/EditorPane";
import { EditorTabs } from "../features/editor/EditorTabs";
import { useEditor } from "../features/editor/store";
import { ActionPreviewModal } from "../features/health/actions/ActionPreviewModal";
import { ActionProgressModal } from "../features/health/actions/ActionProgressModal";
import { JsonbEditorModal } from "../features/jsonb/JsonbEditorModal";
// Onboarding-tour entry point temporarily disabled — 
// import { startOnboardingTour } from "../features/onboarding-tour";
import { Spg99StatusBarWidget, Spg99TemplatePickerDialog } from "../features/paid-modules";
import { ConnectionBanner } from "../features/schema/ConnectionBanner";
import { SchemaBrowser } from "../features/schema/SchemaBrowser";
import { useSchema } from "../features/schema/store";
import { SupportButton } from "../features/support/SupportButton";
import { formatHotkey } from "../lib/platform";
import { openSettings } from "./SettingsModal";

/**
 * Workspace shell — quiet redesign (handoff/layout.md §workspace).
 *
 * Layout:
 * .titlebar (macOS-style, 36px)
 * .body (flex 1)
 * left rail (220px, connections list + theme/lang)
 * main (flex 1) — banner, tabs, editor / details
 * right inspector (260px) — schema tree
 * .statusbar (24px)
 */
export default function Workspace(): JSX.Element {
  const { t } = useTranslation();
  const openCreateForm = useConnections((s) => s.openCreateForm);
  const connection = useSchema((s) => s.connection);
  const isConnected = connection.status === "connected";
  const connections = useConnections((s) => s.connections);
  const selectedId = useConnections((s) => s.selectedId);
  const hydrated = useEditor((s) => s.hydrated);

  const safetyModal = useEditor((s) => s.safetyModal);

  const liveOpsTargetId = connection.status === "connected" ? connection.connId : selectedId;
  const liveOpsLabel = t("live_ops.tab.title");
  const liveOpsHotkey = formatHotkey("Shift", "L");
  const openLiveOpsForSelected = (): void => {
    if (liveOpsTargetId !== null) {
      useEditor.getState().openLiveOpsTab(liveOpsTargetId);
    }
  };

  const activeConnName = (() => {
    if (connection.status === "connected") {
      return connections.find((c) => c.id === connection.connId)?.name ?? null;
    }
    if (selectedId) {
      return connections.find((c) => c.id === selectedId)?.name ?? null;
    }
    return null;
  })();
  const activeDb = (() => {
    if (connection.status === "connected") return connection.database;
    if (selectedId) return connections.find((c) => c.id === selectedId)?.database ?? null;
    return null;
  })();

  useEffect(() => {
    if (!hydrated) {
      void useEditor.getState().hydrateFromSqlite();
    }
  }, [hydrated]);

  // — handle MCP-driven editor actions. McpActionListener (mounted
  // at App root) translates backend `mcp:action` events into local
  // CustomEvent's; here we land them in the Workspace context so the
  // editor store (which itself depends on Workspace state) can react.
  useEffect(() => {
    const onOpenQuery = (e: Event) => {
      const detail = (e as CustomEvent<{ sql?: string; connId?: string | null }>).detail;
      if (!detail || typeof detail.sql !== "string") return;
      const conn = useSchema.getState().connection;
      const fallbackId = conn.status === "connected" ? conn.connId : null;
      const connId = detail.connId ?? fallbackId;
      useEditor.getState().openEditorTab(connId, { prefillSql: detail.sql });
    };
    window.addEventListener("ide99:open-query", onOpenQuery);
    return () => window.removeEventListener("ide99:open-query", onOpenQuery);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const editor = useEditor.getState();
      const conn = useSchema.getState().connection;
      const activeConnId = conn.status === "connected" ? conn.connId : null;

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        editor.openEditorTab(activeConnId);
      } else if (e.key === "w" || e.key === "W") {
        const id = editor.activeTabId;
        if (id !== null) {
          e.preventDefault();
          const tab = editor.tabs.find((x) => x.id === id);
          if (tab && tab.kind === "editor" && tab.dirty) {
            window.dispatchEvent(new CustomEvent("editor.requestCloseActive"));
          } else {
            void editor.closeTab(id);
          }
        }
      } else if ((e.key === "h" || e.key === "H") && !e.shiftKey) {
        e.preventDefault();
        editor.openHistoryTab();
      } else if ((e.key === "L" || e.key === "l") && e.shiftKey) {
        // — Cmd+Shift+L opens (or focuses) the Live Ops tab for the
        // currently-active connection. Read selectedId via getState() so this
        // listener doesn't need to re-mount on selection changes.
        e.preventDefault();
        const sel = useConnections.getState().selectedId;
        const cid = conn.status === "connected" ? conn.connId : sel !== null ? sel : null;
        if (cid !== null) editor.openLiveOpsTab(cid);
      } else if ((e.key === "f" || e.key === "F") && !e.shiftKey && !e.altKey) {
        // Suppress the WebView's native find-in-page (Cmd+F) — its Close
        // button is partly obscured by a persistent "Close (Escape)"
        // tooltip in the bundled Chromium UI, which left users unable
        // to close the bar via mouse. If the user is currently looking
        // at the History tab, route the keystroke to the SQL search
        // input; otherwise it's a quiet no-op.
        const active = editor.tabs.find((tab) => tab.id === editor.activeTabId);
        if (active?.kind === "history") {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("history.focusSearch"));
        } else {
          e.preventDefault();
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number.parseInt(e.key, 10) - 1;
        const tab = editor.tabs[idx];
        if (tab) {
          e.preventDefault();
          editor.switchTab(tab.id);
        }
      } else if ((e.key === "e" || e.key === "E") && !e.altKey) {
        // — Cmd/Ctrl+E runs EXPLAIN, Cmd/Ctrl+Shift+E runs
        // EXPLAIN ANALYZE. Only meaningful when the active tab is an editor
        // tab (object / history / explain tabs have no SQL of their own to
        // explain). Silent no-op otherwise rather than fighting the user
        // with an alert.
        const active = editor.tabs.find((tab) => tab.id === editor.activeTabId);
        if (active?.kind === "editor") {
          e.preventDefault();
          void editor.runExplain(active.id, e.shiftKey ? "analyze" : "explain");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (    <div className="app-frame">
      <Titlebar
        name={activeConnName ?? "ide99"}
        context={activeDb ?? undefined}
        connected={isConnected}
      />
      <Mesh variant="subtle" />
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          minHeight: 0,
          zIndex: 1,
        }}
      >
        {/* Left rail — connections */}
        <aside
          className="q-sidebar left"
          style={{ width: 220, flex: "0 0 220px" }}
          aria-label={t("connection.list.aria_label")}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 10px 8px",
            }}
          >
            <span
              className="q-eyebrow"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                letterSpacing: "0.12em",
              }}
            >
              {t("connection.list.aria_label", "Подключения")}
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              <button
                type="button"
                onClick={() => openCreateForm()}
                aria-label={t("welcome.no_connections.add")}
                title={t("welcome.no_connections.add")}
                className="btn-icon"
              >
                <Plus size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={!isConnected}
                onClick={openLiveOpsForSelected}
                aria-label={liveOpsLabel}
                title={`${liveOpsLabel} (${liveOpsHotkey})`}
                className="btn-icon"
                data-testid="open-live-ops-btn"
              >
                <Radar size={14} aria-hidden="true" />
              </button>
            </div>
          </header>
          {/* — SPG99 Instant DB toolbar slot temporarily hidden:
              the underlying flow isn't wired up yet, so the button only led
              to the paywall without doing anything useful. Re-enable when the
              Instant DB feature is back. */}
          <div className="q-scroll" style={{ flex: 1, padding: "0 8px 8px", overflowY: "auto" }}>
            <ConnectionList />
          </div>
          {/* Single-row footer: brand on the left, utility icons on the right.
              Was two-row while EasyToggle lived here (its pill width grew in
              Easy mode and overflowed the 220px sidebar). With EasyToggle
              disabled —  — single-row fits.
              When re-enabling EasyToggle, restore the column flexDirection
              and the inner two-div split. */}
          <footer
            style={{
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              borderTop: "1px solid var(--hairline)",
              minWidth: 0,
            }}
          >
            <Wordmark size="sm" />
            {/* <EasyToggle /> — temporarily disabled,  */}
            <div
              style={{
                display: "flex",
                gap: 2,
                alignItems: "center",
                minWidth: 0,
              }}
            >
              {/* Help / restart-tour button — temporarily disabled, see
                                    <button
                    type="button"
                    onClick={() => startOnboardingTour()}
                    aria-label={t("easyMode.help.restartTour")}
                    title={t("easyMode.help.restartTour")}
                    className="btn-icon"
                    data-testid="restart-tour-btn"
                  >
                    <HelpCircle size={14} aria-hidden="true" />
                  </button> */}
              <ThemeSwitcher />
              <LanguageSwitcher />
              <button
                type="button"
                onClick={() => openSettings()}
                aria-label={t("settings.open")}
                title={`${t("settings.title")} (${formatHotkey(",")})`}
                className="btn-icon"
              >
                <Settings size={14} aria-hidden="true" />
              </button>
            </div>
          </footer>
        </aside>

        {/* Main area */}
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <ConnectionBanner />
          {isConnected ? (            <>
              <EditorTabs />
              <div style={{ flex: 1, minHeight: 0 }} id="editor-pane-host">
                <EditorPane />
              </div>
              {/* — Generated SQL panel for Easy mode. Returns null
                  in Standard mode so the layout collapses cleanly. Sits
                  between EditorPane and the status bar per design §1
                  (Easy mode layout). */}
              <BidirectionalSqlPanel />
            </>
) : (            <div className="q-scroll" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              <ConnectionDetails />
            </div>
)}
        </main>

        {/* Right inspector */}
        <aside className="q-sidebar right" style={{ width: 260, flex: "0 0 260px" }}>
          <SchemaBrowser />
        </aside>
      </div>

      {/* Statusbar */}
      <div className="q-statusbar">
        <span className="q-fchip">
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 50,
              background: isConnected ? "var(--accent)" : "var(--ink-5)",
              boxShadow: isConnected ? "0 0 0 3px var(--accent-soft)" : "none",
              display: "inline-block",
            }}
          />
          {isConnected ? t("connection.banner.connected") : t("connection.banner.disconnected")}
        </span>
        <span className="q-fchip mono">{activeDb ?? "—"}</span>
        {/* — SPG99 active Instant DB widget. v1.0: passes
            activeInstantDb={null} (no real tracker yet) → widget renders
            null without subscription too, so no clutter. v1.1 wires the
            connection-store badge tracker. */}
        <span className="q-fchip" style={{ marginLeft: "auto" }}>
          <Spg99StatusBarWidget activeInstantDb={null} />
        </span>
        <SupportButton />
        <span className="q-fchip">UTF-8</span>
      </div>

      {/* — S13 modals lifted from HealthPane to Workspace so that
       * Live Ops Sessions right-click can also summon them. */}
      <ActionPreviewModal />
      <ActionProgressModal />

      {/* — JSONB editor mounts once at workspace level; opens on
       * dbl-click of a json/jsonb result-grid cell. */}
      <JsonbEditorModal />

      {/* — SPG99 Instant DB template picker. Listens for the
       * global `ide99:spg99:open-template-picker` window event and shows a
       * Radix Dialog when subscribed. Mounting here keeps a single
       * instance for both Connection-toolbar and Health "Reproduce on
       * disposable" dispatchers. */}
      <Spg99TemplatePickerDialog />

      {/* Post-S14 — consolidated batch-confirm modal for multi-statement
       * destructive runs. The N=1 destructive path still goes through the
       * legacy ConfirmDestructiveModal (mounted in App.tsx) — see
       * preflightBatch for the dispatch. */}
      {safetyModal.kind === "batchConfirm" && (        <BatchConfirmModal
          open
          total={safetyModal.total}
          environment={safetyModal.environment}
          databaseName={safetyModal.databaseName}
          destructive={safetyModal.destructive}
          onConfirm={safetyModal.onConfirm}
          onCancel={safetyModal.onCancel}
        />
)}
    </div>
);
}
