import type { JSX, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SessionsSnapshot } from "../../../lib/tauri";
import { useLiveOps } from "../store";

interface Props {
  snapshot: SessionsSnapshot;
  connId: string;
}

function shortQuery(q: string, max: number): string {
  const t = q.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Match SessionsDag's `localizeState` so list + DAG agree on the visible label. */
function localizeState(  t: (key: string, options?: { defaultValue: string }) => string,
  raw: string,
): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_|_$/g, "");
  return t(`live_ops.sessions.state.${slug}`, { defaultValue: raw });
}

export function SessionsList({ snapshot, connId }: Props): JSX.Element {
  const { t } = useTranslation();
  const blockedSet = new Set<number>();
  for (const e of snapshot.blockingEdges) blockedSet.add(e.blockedPid);
  return (    <table className="live-ops-sessions-table">
      <thead>
        <tr>
          <th>{t("live_ops.sessions.list.col.pid")}</th>
          <th>{t("live_ops.sessions.list.col.user")}</th>
          <th>{t("live_ops.sessions.list.col.state")}</th>
          <th>{t("live_ops.sessions.list.col.duration")}</th>
          <th>{t("live_ops.sessions.list.col.wait")}</th>
          <th>{t("live_ops.sessions.list.col.query")}</th>
        </tr>
      </thead>
      <tbody>
        {snapshot.sessions.map((s) => {
          const isBlocked = blockedSet.has(s.pid);
          const onCtx = (e: MouseEvent) => {
            e.preventDefault();
            useLiveOps.getState().openContextMenu(connId, e.clientX, e.clientY, s);
          };
          return (            <tr
              key={s.pid}
              className={isBlocked ? "is-blocked" : ""}
              onContextMenu={onCtx}
              data-testid={`session-node-${s.pid}`}
            >
              <td className="mono">{s.pid}</td>
              <td>
                {s.username}
                {s.applicationName ? `@${s.applicationName}` : ""}
              </td>
              <td title={s.state}>{localizeState(t, s.state)}</td>
              <td className="mono num">
                {s.durationSeconds !== null && s.durationSeconds >= 0
                  ? `${Math.round(s.durationSeconds)} с`
                  : "—"}
              </td>
              <td className="mono">
                {s.waitEvent ? `${s.waitEventType ?? "?"}/${s.waitEvent}` : "—"}
              </td>
              <td className="mono query">{shortQuery(s.query, 120)}</td>
            </tr>
);
        })}
      </tbody>
    </table>
);
}
