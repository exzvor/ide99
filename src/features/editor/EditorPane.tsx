import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { BackupCenter } from "../backup";
import { CoachMark } from "../coach-marks";
import { ErdPane } from "../erd";
import { HealthPane } from "../health";
import { HistoryTab } from "../history/HistoryTab";
import { LiveOpsPane } from "../live-ops/LiveOpsPane";
import { MigrationsPanel } from "../migrations";
import { NotebookPane } from "../notebook";
import { ObjectEditorTab } from "../object-editor";
import { PgStatStatementsTab } from "../pgstatstatements";
import { MapViewTab } from "../postgis";
import { RecentPlansTab as RecentPlansTabPane } from "../recent-plans";
import { ObjectDetails } from "../schema/ObjectDetails";
import { EmptyState } from "./EmptyState";
import { MonacoEditor } from "./MonacoEditor";
import { ResultPanel } from "./ResultPanel";
import { RunToolbar } from "./RunToolbar";
import { ExplainPane, PlanDiffPane } from "./explain";
import { useEditor } from "./store";

/**
 * Active-tab body (spec §5.1, §7.3).
 *
 * Branches on `tab.kind`:
 * - `editor` → fixed 60 / 40 vertical split: Monaco on top, RunToolbar +
 * ResultPanel on bottom. Draggable splitter is deferred to S5+.
 * - `object` → delegates to S3's `<ObjectDetails />` so column / index /
 * foreign-key + view definition tabs render exactly as they do in the
 * schema browser.
 * - no active tab → `<EmptyState />`.
 */

export function EditorPane(): JSX.Element {
  const { t } = useTranslation();
  const tabs = useEditor((s) => s.tabs);
  const activeTabId = useEditor((s) => s.activeTabId);
  const tab = activeTabId === null ? null : (tabs.find((t) => t.id === activeTabId) ?? null);

  const paneStyle: React.CSSProperties = {
    height: "100%",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
  };

  if (tab === null) {
    return (
      <div id="editor-pane" role="tabpanel" style={paneStyle} data-testid="editor-pane">
        <EmptyState />
      </div>
    );
  }

  if (tab.kind === "object") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <ObjectDetails node={tab.nodeKey} />
      </div>
    );
  }

  if (tab.kind === "history") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <HistoryTab />
      </div>
    );
  }

  if (tab.kind === "map-view") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <MapViewTab tab={tab} />
      </div>
    );
  }

  if (tab.kind === "pg-stat-statements") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <PgStatStatementsTab tab={tab} />
      </div>
    );
  }

  if (tab.kind === "explain") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <ExplainPane tabId={tab.id} />
      </div>
    );
  }

  if (tab.kind === "recent-plans") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <RecentPlansTabPane />
      </div>
    );
  }

  if (tab.kind === "plan-diff") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <PlanDiffPane tabId={tab.id} />
      </div>
    );
  }

  if (tab.kind === "health") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <HealthPane connId={tab.connectionId} />
      </div>
    );
  }

  if (tab.kind === "live-ops") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <LiveOpsPane connId={tab.connectionId} />
      </div>
    );
  }

  if (tab.kind === "erd") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <ErdPane connId={tab.connectionId} schemas={tab.schemas} tabId={tab.id} />
      </div>
    );
  }

  if (tab.kind === "migrations") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <MigrationsPanel connectionId={tab.connectionId} />
      </div>
    );
  }

  if (tab.kind === "object-editor") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <ObjectEditorTab tab={tab} />
      </div>
    );
  }

  if (tab.kind === "notebook") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <NotebookPane tab={tab} />
      </div>
    );
  }

  if (tab.kind === "backup") {
    return (
      <div
        id="editor-pane"
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab.id}`}
        style={paneStyle}
        data-testid="editor-pane"
      >
        <BackupCenter tab={tab} />
      </div>
    );
  }

  return (
    <div
      id="editor-pane"
      role="tabpanel"
      aria-labelledby={`editor-tab-${tab.id}`}
      style={paneStyle}
      data-testid="editor-pane"
    >
      <div
        className="q-editor-canvas"
        style={{ display: "flex", flex: 3, minHeight: 0, flexDirection: "column" }}
      >
        <div style={{ padding: "0 12px" }}>
          <CoachMark
            id="editor-shortcuts"
            title={t("coach.editor_shortcuts.title")}
            body={t("coach.editor_shortcuts.body")}
            dismissLabel={t("coach.dismiss")}
          />
        </div>
        <MonacoEditor tabId={tab.id} />
      </div>
      <div
        style={{
          display: "flex",
          flex: 2,
          minHeight: 0,
          flexDirection: "column",
          borderTop: "1px solid var(--hairline)",
          background: "var(--bg)",
        }}
      >
        <RunToolbar tabId={tab.id} />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            // Clip overflow so result-grid rows can't sub-pixel-render into
            // the toolbar zone above during a fast scroll (sticky-header glitch).
            overflow: "hidden",
          }}
        >
          <ResultPanel tabId={tab.id} />
        </div>
      </div>
    </div>
  );
}
