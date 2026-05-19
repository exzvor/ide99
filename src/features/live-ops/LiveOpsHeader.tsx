import { RefreshCw } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../connections/store";
import { useLiveOps } from "./store";
import type { SubTab } from "./types";

interface Props {
  connId: string;
}

const SUB_TABS: readonly SubTab[] = ["sessions", "slow", "replication"] as const;
const INTERVAL_OPTIONS: readonly { value: number | null; labelKey: string; ms: number | null }[] = [
  { value: null, labelKey: "live_ops.header.interval_off", ms: null },
  { value: 1000, labelKey: "live_ops.header.interval_1s", ms: 1000 },
  { value: 2000, labelKey: "live_ops.header.interval_2s", ms: 2000 },
  { value: 5000, labelKey: "live_ops.header.interval_5s", ms: 5000 },
  { value: 10000, labelKey: "live_ops.header.interval_10s", ms: 10000 },
];

function envCapMs(env: string): number {
  return env === "prod" || env === "stage" ? 2000 : 1000;
}

export function LiveOpsHeader({ connId }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const slice = useLiveOps((s) => s.byConn.get(connId));
  const env = useConnections(    (s) => s.connections.find((c) => c.id === connId)?.environment ?? "local",
);

  // Cosmetic relative-time refresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(h);
  }, []);

  if (!slice) return null;
  const sub = slice.activeSubTab;
  const subSlice = slice[sub];
  const interval = subSlice.intervalMs;
  const cap = envCapMs(env);
  const lastFetched = subSlice.data.status === "ready" ? subSlice.data.fetchedAt : null;
  // €” was hardcoded "Ns ago" string, leaking English into RU UI.
  // The same i18n pattern as health.header.last_refreshed.
  const relative = lastFetched
    ? t("live_ops.header.x_ago", {
        seconds: Math.max(0, Math.round((Date.now() - lastFetched) / 1000)),
      })
    : "â€”";

  return (    <div className="live-ops-header" data-testid="live-ops-header">
      <div className="live-ops-tab-group">
        {SUB_TABS.map((s) => (          <button
            key={s}
            type="button"
            className="btn-tab"
            aria-current={sub === s ? "page" : undefined}
            onClick={() => useLiveOps.getState().setActiveSubTab(connId, s)}
            data-testid={`live-ops-subtab-${s}`}
          >
            {t(`live_ops.subtab.${s}`)}
          </button>
))}
      </div>
      <select
        className="q-input"
        style={{ width: "auto", maxWidth: 120, height: 28 }}
        value={interval === null ? "off" : String(interval)}
        onChange={(e) => {
          const v = e.target.value;
          useLiveOps.getState().setIntervalMs(connId, v === "off" ? null : Number(v));
        }}
        aria-label={t("live_ops.header.interval_label")}
        data-testid="live-ops-interval-select"
      >
        {INTERVAL_OPTIONS.map((o) => {
          const disabled = o.ms !== null && o.ms < cap;
          return (            <option
              key={o.value === null ? "off" : o.value}
              value={o.value === null ? "off" : String(o.value)}
              disabled={disabled}
              title={
                disabled
                  ? t("live_ops.header.env_capped_tooltip", { min: cap / 1000, env })
                  : undefined
              }
            >
              {t(o.labelKey)}
            </option>
);
        })}
      </select>
      <button
        type="button"
        className="btn-icon"
        onClick={() => void useLiveOps.getState().refreshNow(connId)}
        aria-label={t("live_ops.header.refresh_now")}
        data-testid="live-ops-refresh-btn"
      >
        <RefreshCw size={14} aria-hidden="true" />
      </button>
      <span className="last-refresh">{t("live_ops.header.last_refresh", { relative })}</span>
    </div>
);
}
