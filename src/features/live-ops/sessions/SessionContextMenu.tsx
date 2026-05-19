import { type JSX, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../../connections/store";
import { useHealthActions } from "../../health/actions/store";
import { useLiveOps } from "../store";

interface Props {
  connId: string;
}

/**
 * Session action popover. Plain `<div role="menu">` styled by `.q-popover`,
 * matching `SchemaTree` and `ConnectionList`. We deliberately don't use the
 * Radix DropdownMenu here because its Floating-UI positioning ignored our
 * fixed (mouse-anchored) coordinates and rendered the panel as ghost text.
 *
 * The menu opens via left-click on a session card (see `SessionsDag`).
 * Closes on Escape or click outside.
 */
export function SessionContextMenu({ connId }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const menu = useLiveOps((s) => s.byConn.get(connId)?.contextMenu);
  const conn = useConnections((s) => s.connections.find((c) => c.id === connId));
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape — same UX as SchemaTree's context menu.
  useEffect(() => {
    if (!menu?.open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        useLiveOps.getState().closeContextMenu(connId);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useLiveOps.getState().closeContextMenu(connId);
    };
    // Defer attaching mousedown by one tick so the click that OPENED the menu
    // doesn't immediately bubble back here and close it.
    const tid = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu?.open, connId]);

  if (!menu?.open || !conn) return null;

  const handle = (terminate: boolean) => () => {
    useLiveOps.getState().closeContextMenu(connId);
    useHealthActions
      .getState()
      .openPreview({ kind: "killPid", pid: menu.pid, query: menu.query, terminate }, conn);
  };

  return (    <div
      ref={ref}
      role="menu"
      className="q-popover"
      style={{ position: "fixed", left: menu.x, top: menu.y, minWidth: 240, zIndex: 80 }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={() => {}}
      data-testid="session-context-menu"
    >
      <button type="button" role="menuitem" onClick={handle(false)} className="q-popover-item">
        {t("live_ops.sessions.cancel")}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={handle(true)}
        className="q-popover-item danger"
      >
        {t("live_ops.sessions.terminate")}
      </button>
    </div>
);
}
