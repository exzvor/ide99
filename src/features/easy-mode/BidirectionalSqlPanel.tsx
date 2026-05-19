/**
 * — Generated SQL panel for Easy mode.
 *
 * Subscribes to `useEditor` for the active editor tab's `QueryShape`
 * (bidirectional struct: filters / sort / limit) and renders it as
 * pretty-printed canonical SQL. When the WHERE clause changes, applies a
 * brief `data-changed-recently` attribute (~2s) so CSS can pulse the panel
 * — the visual cue per design spec §2.
 *
 * Visibility: `display: none` outside Easy mode. Collapsible via the ▴/▾
 * affordance in the header.
 *
 * The panel is rendered inside Workspace's main column, between EditorPane
 * and the status bar.
 */

import { type JSX, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor } from "../editor/store";
import { shapeToSql, whereSignature } from "./shapeToSql";
import { useUiMode } from "./store";

export interface BidirectionalSqlPanelProps {
  /**
   * Optional override — when supplied, takes precedence over the active-tab
   * shape. Tests use this to drive deterministic input; production callers
   * leave it undefined and the component reads from `useEditor`.
   */
  sql?: string;
}

export function BidirectionalSqlPanel(props: BidirectionalSqlPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const mode = useUiMode((s) => s.mode);
  const [collapsed, setCollapsed] = useState(false);
  const [pulse, setPulse] = useState(false);

  // Active editor tab → its current QueryShape. We resolve the shape from the
  // store directly rather than passing it in as a prop so the panel stays
  // a drop-in addition to Workspace.
  const activeTabId = useEditor((s) => s.activeTabId);
  const activeTabKind = useEditor((s) => {
    const tab = activeTabId ? s.tabs.find((entry) => entry.id === activeTabId) : null;
    return tab?.kind ?? null;
  });
  const shape = useEditor((s) =>
    activeTabId !== null ? (s.queryShapes.get(activeTabId) ?? null) : null,
  );

  // WHERE-pulse: whenever the WHERE signature changes, briefly mark the panel
  // so CSS can flash the affected region. We track the previous signature in
  // a ref so initial mount doesn't pulse (no "change" yet).
  const prevWhereRef = useRef<string>(whereSignature(shape));
  useEffect(() => {
    const next = whereSignature(shape);
    if (next !== prevWhereRef.current) {
      prevWhereRef.current = next;
      setPulse(true);
      const timeout = window.setTimeout(() => setPulse(false), 2000);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [shape]);

  if (mode !== "easy") return null;
  // The panel mirrors a SQL-editor's bidirectional QueryShape — it has no
  // meaning when the active tab is an object editor, ERD, history, etc.
  // Without this guard the bidirectional-SQL hint banner appeared under every kind of tab in Easy mode
  // even though there was no SQL editor above to mirror. We hide only when
  // there's a definite non-editor tab in focus; when `activeTabKind` is null
  // (no tabs hydrated yet, or tests that drive shape directly) we still
  // render so the existing test fixtures keep working.
  if (props.sql === undefined && activeTabKind !== null && activeTabKind !== "editor") {
    return null;
  }

  const sql = props.sql ?? (shape ? shapeToSql(shape) : "");

  return (
    <aside
      className="bidi-sql-panel"
      data-collapsed={collapsed}
      data-changed-recently={pulse ? "true" : undefined}
      data-testid="bidi-sql-panel"
      aria-label={t("easyMode.bidi.title")}
    >
      <header className="bidi-sql-panel-header">
        <span className="bidi-sql-panel-title">
          <span aria-hidden="true">✨ </span>
          {t("easyMode.bidi.title")}
        </span>
        <button
          type="button"
          className="bidi-sql-panel-toggle btn-icon"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={t("easyMode.bidi.toggle")}
          data-testid="bidi-sql-panel-toggle"
        >
          {collapsed ? "▾" : "▴"}
        </button>
      </header>
      {!collapsed ? (
        <>
          <pre className="bidi-sql-panel-body" data-testid="bidi-sql-panel-body">
            {sql}
          </pre>
          <p className="bidi-sql-panel-hint">{t("easyMode.bidi.hint")}</p>
        </>
      ) : null}
    </aside>
  );
}
