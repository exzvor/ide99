/**
 * Debounced (300ms) synchronizer from state stores to the MCP bridge.
 *
 * Whenever one of the subscriptions changes (active connection, editor
 * tabs, run states, last result), it builds a full `IdeBridgeState`
 * snapshot and pushes it to the backend via `mcp_bridge_update`. The
 * backend stores it behind an RwLock; the frontend does not need to
 * filter — the bridge is a full-replace, not a diff.
 *
 * Cheap guard: if the snapshot is JSON-equivalent to the previous one,
 * we skip the invoke. Otherwise, even in idle the 300ms debouncer would
 * fire every few seconds because Map keys change identity.
 */

import { useEffect } from "react";
import { useConnections } from "../connections/store";
import { useEditor } from "../editor/store";
import { useSchema } from "../schema/store";
import { type IdeBridgeState, type TabKind, mcpBridgeUpdate } from "./api";

const DEBOUNCE_MS = 300;

function buildSnapshot(): IdeBridgeState {
  const editor = useEditor.getState();
  const conn = useSchema.getState().connection;
  const activeConnId = conn.status === "connected" ? conn.connId : null;

  const activeTab = editor.tabs.find((t) => t.id === editor.activeTabId) ?? null;

  let editorContent = "";
  let editorSelection: [number, number] | null = null;
  if (activeTab && activeTab.kind === "editor") {
    editorContent = activeTab.content;
    const sel = editor.selectionByTab.get(activeTab.id) ?? null;
    if (sel !== null && sel.length > 0) {
      const idx = activeTab.content.indexOf(sel);
      if (idx >= 0) editorSelection = [idx, idx + sel.length];
    }
  }

  const openTabs = editor.tabs
    .map((t): { id: string; title: string; connId: string | null; kind: TabKind } | null => {
      switch (t.kind) {
        case "editor":
          return { id: t.id, title: t.name, connId: t.connectionId, kind: "query" };
        case "object-editor":
          return {
            id: t.id,
            title: `${t.target.schema}.${t.target.name ?? t.target.parentTable ?? "_new"}`,
            connId: t.connectionId,
            kind: "object-editor",
          };
        case "health":
          return { id: t.id, title: "Health", connId: t.connectionId, kind: "health-screen" };
        case "live-ops":
          return { id: t.id, title: "Live Ops", connId: t.connectionId, kind: "live-ops" };
        case "erd":
          return { id: t.id, title: "ERD", connId: t.connectionId, kind: "erd" };
        case "migrations":
          return {
            id: t.id,
            title: "Migrations",
            connId: t.connectionId,
            kind: "migrations",
          };
        default:
          return null;
      }
    })
    .filter(
      (x): x is { id: string; title: string; connId: string | null; kind: TabKind } => x !== null,
    );

  const healthScreenVisible = activeTab?.kind === "health";

  // Last-query snapshot: pull the most recent streaming/error RunState.
  let lastQuery: IdeBridgeState["lastQuery"] = null;
  let lastResult: IdeBridgeState["lastResult"] = null;
  if (activeTab && activeTab.kind === "editor") {
    const rs = editor.runStates.get(activeTab.id);
    if (rs && rs.status === "streaming" && activeTab.connectionId !== null) {
      lastQuery = {
        sql: activeTab.content,
        connId: activeTab.connectionId,
        startedAt: new Date().toISOString(),
        durationMs: rs.durationMs,
        rowCount: rs.affectedRows ?? rs.loadedCount,
        error: null,
      };
      lastResult = {
        columns: rs.columns.map((c) => c.name),
        rows: rs.rows.slice(0, 1000),
        truncated: rs.rows.length > 1000 || !rs.exhausted,
      };
    } else if (rs && rs.status === "error" && activeTab.connectionId !== null) {
      lastQuery = {
        sql: activeTab.content,
        connId: activeTab.connectionId,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        rowCount: null,
        error: rs.detail ?? rs.code,
      };
    }
  }

  return {
    activeConnId,
    editorContent,
    editorSelection,
    lastQuery,
    lastResult,
    openTabs,
    healthScreenVisible,
  };
}

export function useMcpBridgeSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastJson = "";
    let cancelled = false;

    const send = () => {
      if (cancelled) return;
      const snap = buildSnapshot();
      const json = JSON.stringify(snap);
      if (json === lastJson) return;
      lastJson = json;
      void mcpBridgeUpdate(snap).catch(() => {
        // Bridge is best-effort: backend may be off (MCP disabled), don't
        // surface to user — backend logs internally.
      });
    };

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(send, DEBOUNCE_MS);
    };

    // Initial push so backend has *something* before the first state change.
    schedule();

    const unEditor = useEditor.subscribe(schedule);
    const unConn = useConnections.subscribe(schedule);
    const unSchema = useSchema.subscribe(schedule);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unEditor();
      unConn();
      unSchema();
    };
  }, []);
}
