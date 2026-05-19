import type { JSX } from "react";
import { useEffect } from "react";
import { useConnections } from "../connections/store";
import { useEditor } from "../editor/store";
import { LiveOpsHeader } from "./LiveOpsHeader";
import { ReplicationPane } from "./replication/ReplicationPane";
import { SessionsPane } from "./sessions/SessionsPane";
import { SlowQueriesPane } from "./slow/SlowQueriesPane";
import { useLiveOps } from "./store";

interface Props {
  connId: string;
}

export function LiveOpsPane({ connId }: Props): JSX.Element {
  const env = useConnections(    (s) => s.connections.find((c) => c.id === connId)?.environment ?? "local",
);
  const slice = useLiveOps((s) => s.byConn.get(connId));

  // Mount: ensure prefs + start polling
  useEffect(() => {
    useLiveOps.getState().ensureConn(connId, env);
    void useLiveOps.getState().refreshNow(connId);
    useLiveOps.getState().startPolling(connId);
    return () => {
      useLiveOps.getState().stopPolling(connId);
    };
  }, [connId, env]);

  // Pause on hidden, resume on visible
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void useLiveOps.getState().refreshNow(connId);
        useLiveOps.getState().startPolling(connId);
      } else {
        useLiveOps.getState().stopPolling(connId);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [connId]);

  // Cmd/Ctrl+R when this tab is active
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key !== "r") return;
      if (useEditor.getState().activeTabId !== `live-ops-${connId}`) return;
      e.preventDefault();
      e.stopPropagation();
      void useLiveOps.getState().refreshNow(connId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connId]);

  return (    <div className="live-ops-pane" data-testid="live-ops-pane">
      <LiveOpsHeader connId={connId} />
      {slice?.activeSubTab === "sessions" && <SessionsPane connId={connId} />}
      {slice?.activeSubTab === "slow" && <SlowQueriesPane connId={connId} />}
      {slice?.activeSubTab === "replication" && <ReplicationPane connId={connId} />}
    </div>
);
}
