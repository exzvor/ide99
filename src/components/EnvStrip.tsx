import { useEffect, useState } from "react";
import { useConnections } from "../features/connections/store";
import { useEditor } from "../features/editor/store";
import type { Environment } from "../lib/tauri";

const COLOR_MAP: Record<Environment, string> = {
  local: "transparent",
  dev: "var(--env-dev)",
  stage: "var(--env-stage)",
  prod: "var(--env-prod)",
};

/**
 * — 3px env-color strip placed under the title bar.
 *
 * Reads the active editor tab's connection environment; transparent when
 * no active tab, the active tab has no connection, or the connection's
 * environment is `local` (the day-to-day default).
 */
export function EnvStrip() {
  const [color, setColor] = useState<string>("transparent");
  const connections = useConnections((s) => s.connections);
  const activeTabId = useEditor((s) => s.activeTabId);
  const tabs = useEditor((s) => s.tabs);

  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    const connId =
      tab && (tab.kind === "editor" || tab.kind === "object") ? (tab.connectionId ?? null) : null;
    const conn = connId ? connections.find((c) => c.id === connId) : null;
    setColor(conn ? COLOR_MAP[conn.environment] : "transparent");
  }, [activeTabId, tabs, connections]);

  return <div className="env-strip" style={{ background: color }} aria-hidden />;
}
