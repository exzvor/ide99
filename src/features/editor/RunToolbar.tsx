import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu } from "../../components/DropdownMenu";
import { formatHotkey } from "../../lib/platform";
import { useConnections } from "../connections/store";
import { useSchema } from "../schema/store";
import { splitStatements } from "./sql/splitStatements";
import { type RunIntent, useEditor } from "./store";

/**
 * Toolbar shown above the editor for the active tab.
 *
 * Layout:
 * [ Run button ] [ Connection dropdown ]
 *
 * Run button:
 * - Primary style; disabled when the tab has no connection or a query is
 * already running. Click triggers `runQuery(tabId, null)` which the store
 * interprets as "run the entire tab content".
 *
 * Connection dropdown:
 * - Shows the currently-bound connection's name (or "No connection").
 * - Opening the dropdown lists every saved connection; selecting one calls
 * `setTabConnection(tabId, conn.id)`.
 */

interface RunToolbarProps {
  tabId: string;
}

export function RunToolbar({ tabId }: RunToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const tab = useEditor((s) => s.tabs.find((entry) => entry.id === tabId));
  const runState = useEditor((s) => s.runStates.get(tabId)) ?? { status: "idle" as const };
  const connections = useConnections((s) => s.connections);
  const schemaConnection = useSchema((s) => s.connection);

  const tabConnId = tab && tab.kind === "editor" ? tab.connectionId : null;
  // Auto-bind the tab to the currently active schema connection. Three
  // failure modes the user reported:
  // 1. tab created before connecting (`tab.connectionId === null`)
  // 2. tab restored from SQLite with a stale id of a connection that no
  // longer exists (delete + recreate, or hydrate before connections.load
  // finished — both produced "connection is no longer active" on Run).
  // 3. tab bound to a different (non-active) connection — only one pool
  // runs at a time, so a non-active binding always fails on Run.
  // Fix all three at one point: if an active schema pool exists and
  // tab.connectionId is empty, stale, or does not match the active one,
  // rebind it to the active connection.
  const activeConnIdEffect =
    schemaConnection.status === "connected" ? schemaConnection.connId : null;
  const tabConnIsValid = !!tabConnId && connections.some((c) => c.id === tabConnId);
  useEffect(() => {
    if (!tab || tab.kind !== "editor") return;
    if (!activeConnIdEffect) return;
    if (!tabConnId || !tabConnIsValid || tabConnId !== activeConnIdEffect) {
      useEditor.getState().setTabConnection(tabId, activeConnIdEffect);
    }
  }, [tab, tabConnId, tabConnIsValid, activeConnIdEffect, tabId]);

  if (!tab || tab.kind !== "editor") {
    return <div data-testid="run-toolbar-empty" />;
  }

  const connectionId = tab.connectionId;
  // "Running" from the toolbar's POV covers both the cursor-open phase
  // and the in-flight first FETCH; either way, don't let Run fire again.
  const isRunning = runState.status === "opening";
  // We only have one active pool at a time — running against a tab whose
  // connectionId differs from the currently connected one would fall through
  // with `not_connected`. Disable Run unless the tab's connection IS the
  // active one.
  const activeConnId = schemaConnection.status === "connected" ? schemaConnection.connId : null;
  const runDisabled = !connectionId || isRunning || connectionId !== activeConnId;

  const connectionName = connectionId
    ? (connections.find((c) => c.id === connectionId)?.name ?? null)
    : null;

  // Read primitives separately so each selector returns an identity-stable
  // value — picking the intent inside `useEditor((s)=>…)` would create a new
  // object every render and trigger React's "infinite re-render" guard.
  const selText = useEditor((s) => s.selectionByTab.get(tabId) ?? null);
  const curStmt = useEditor((s) => s.currentStatementByTab.get(tabId) ?? null);
  const intent: RunIntent =
    selText && selText.trim().length > 0
      ? { kind: "selection", text: selText }
      : curStmt
        ? { kind: "current" }
        : { kind: "noop" };
  const onRun = () => {
    if (runDisabled || intent.kind === "noop") return;
    void useEditor.getState().runQuery(tabId, intent);
  };

  // Only the currently-active connection is selectable from the dropdown
  // (matches the 1-pool-at-a-time model). Unbinding via "No connection" is
  // always available so the user can detach a tab.
  const activeConn = activeConnId ? connections.find((c) => c.id === activeConnId) : null;
  const dropdownItems = [
    ...(activeConn
      ? [
          {
            label: activeConn.name,
            onSelect: () => useEditor.getState().setTabConnection(tabId, activeConn.id),
          },
        ]
      : []),
    {
      label: t("editor.run.no_connection"),
      onSelect: () => useEditor.getState().setTabConnection(tabId, null),
    },
  ];

  return (
    <div className="q-runbar" data-testid="run-toolbar">
      <button
        type="button"
        onClick={onRun}
        disabled={runDisabled || intent.kind === "noop"}
        aria-label={t("editor.run.button")}
        title={formatHotkey("Enter")}
        className="btn btn-accent btn-sm"
      >
        {isRunning ? (
          <>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 11,
                height: 11,
                borderRadius: "50%",
                border: "2px solid currentColor",
                borderTopColor: "transparent",
                animation: "spin 0.9s linear infinite",
              }}
              data-testid="run-toolbar-spinner"
            />
            <span>{t("editor.run.spinner")}</span>
          </>
        ) : (
          <span>{t("editor.run.button")}</span>
        )}
      </button>

      {(runState.status === "opening" ||
        (runState.status === "streaming" && runState.prefetching)) && (
        <button
          type="button"
          onClick={() => useEditor.getState().cancelRun(tabId)}
          aria-label={t("editor.run.cancel")}
          className="btn btn-sm"
          data-testid="run-toolbar-cancel"
        >
          {t("editor.run.cancel")}
        </button>
      )}

      <RunCaption tabId={tabId} />

      <DropdownMenu
        ariaLabel={t("editor.run.connection_dropdown_label")}
        trigger={
          <button
            type="button"
            aria-label={t("editor.run.connection_dropdown_label")}
            className="btn btn-sm btn-ghost"
          >
            <span>{connectionName ?? t("editor.run.no_connection")}</span>
            <span aria-hidden="true" style={{ fontSize: 9, marginLeft: 2 }}>
              ▾
            </span>
          </button>
        }
        items={dropdownItems}
      />
    </div>
  );
}

function RunCaption({ tabId }: { tabId: string }): JSX.Element | null {
  const { t } = useTranslation();
  const sel = useEditor((s) => s.selectionByTab.get(tabId));
  const cur = useEditor((s) => s.currentStatementByTab.get(tabId));

  // Selection wins over current statement.
  const text = sel && sel.trim().length > 0 ? sel : (cur?.text ?? "");
  if (!text) return null;

  const collapsed = text.replace(/\s+/g, " ").trim();
  const snippet = collapsed.slice(0, 50) + (collapsed.length > 50 ? "…" : "");

  // If the selection covers ≥2 statements, show the count suffix.
  if (sel && sel.trim().length > 0) {
    const stmtCount = splitStatements(sel).length;
    if (stmtCount >= 2) {
      return (
        <span className="q-runbar-caption" title={text} data-testid="run-toolbar-caption">
          {t("editor.run.caption_run_n", { snippet, count: stmtCount })}
        </span>
      );
    }
  }
  return (
    <span className="q-runbar-caption" title={text} data-testid="run-toolbar-caption">
      {t("editor.run.caption_run_one", { snippet })}
    </span>
  );
}
