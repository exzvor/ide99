import { RefreshCw } from "lucide-react";
import { type JSX, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Environment } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { type CardTone, classifyCardTone } from "./cardTone";
import { REFRESH_INTERVALS, isCappedFor } from "./refreshInterval";
import { type CardId, useHealth } from "./store";

interface HealthHeaderProps {
  connId: string;
  lastRefreshAt: number | null;
  refreshIntervalMs: number | null;
  refreshInProgress: boolean;
}

/** Best-effort connection name lookup; falls back to first 8 chars of id. */
function getConnectionName(connId: string, connections: { id: string; name: string }[]): string {
  const found = connections.find((c) => c.id === connId);
  if (found) return found.name;
  return connId.slice(0, 8);
}

function getEnvForConnection(  connId: string,
  connections: { id: string; environment: Environment }[],
): Environment {
  const found = connections.find((c) => c.id === connId);
  return found?.environment ?? "local";
}

function rtfFor(locale: string): Intl.RelativeTimeFormat | null {
  if (typeof Intl === "undefined" || !Intl.RelativeTimeFormat) return null;
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  } catch {
    return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  }
}

function formatRelative(deltaMs: number, locale: string): string {
  const rtf = rtfFor(locale);
  if (!rtf) {
    const sec = Math.round(deltaMs / 1000);
    return `${sec}s ago`;
  }
  const absMs = Math.abs(deltaMs);
  const sec = Math.round(absMs / 1000);
  if (sec < 60) return rtf.format(-sec, "second");
  const min = Math.round(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.round(hr / 24);
  return rtf.format(-day, "day");
}

/** Cap minimum-allowed interval (used in cap_tooltip). */
function minMsForEnv(env: Environment): number {
  if (env === "prod") return 30_000;
  if (env === "stage") return 10_000;
  return 0;
}

/**
 * — Health page header.
 * — adds the mockup's "N critical / N warning / N ok" pill
 * scoreboard derived from each card's CardState via `classifyCardTone`.
 */
export function HealthHeader({
  connId,
  lastRefreshAt,
  refreshIntervalMs,
  refreshInProgress,
}: HealthHeaderProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const connections = useConnections((s) => s.connections);
  const connName = getConnectionName(connId, connections);
  const env = getEnvForConnection(connId, connections);
  const cardsMap = useHealth((s) => s.byConn.get(connId)?.cards);

  const counts = useMemo(() => {
    const acc = { ok: 0, warn: 0, danger: 0, loading: 0 };
    if (!cardsMap) return acc;
    for (const [id, state] of cardsMap.entries()) {
      const tone = classifyCardTone(id as CardId, state);
      if (tone === null) {
        acc.loading++;
        continue;
      }
      acc[tone]++;
    }
    return acc;
  }, [cardsMap]);

  // Tick every 10s so "Last refreshed: 12s ago" stays current.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(handle);
  }, []);

  const lastRefreshedLabel =
    lastRefreshAt === null
      ? t("health.header.last_refreshed_never")
      : t("health.header.last_refreshed", {
          relative: formatRelative(Date.now() - lastRefreshAt, i18n.language),
        });

  const dropdownValue = refreshIntervalMs === null ? "off" : String(refreshIntervalMs);

  function onIntervalChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const v = e.target.value;
    const ms = v === "off" ? null : Number(v);
    useHealth.getState().setRefreshInterval(connId, ms);
  }

  function onRefreshClick(): void {
    void useHealth.getState().refreshAll(connId);
  }

  const intervalLabel =
    refreshIntervalMs === null
      ? t("health.header.auto_refresh_off")
      : t("health.header.auto_refresh_value", {
          seconds: Math.round(refreshIntervalMs / 1000),
        });

  return (    <div
      data-testid="health-header"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
        padding: "16px 24px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--bg-elev)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>
          {t("health.header.title_inline", { connection: connName })}
        </div>
        <div data-testid="health-last-refreshed" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
          {lastRefreshedLabel} ·{" "}
          {t("health.header.auto_refresh_summary", { interval: intervalLabel })}
        </div>
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {counts.danger > 0 ? (          <span className="q-pill crit" data-testid="health-pill-critical">
            {t("health.header.pill_critical", { count: counts.danger })}
          </span>
) : null}
        {counts.warn > 0 ? (          <span className="q-pill warn" data-testid="health-pill-warning">
            {t("health.header.pill_warning", { count: counts.warn })}
          </span>
) : null}
        {counts.ok > 0 ? (          <span className="q-pill ok" data-testid="health-pill-ok">
            {t("health.header.pill_ok", { count: counts.ok })}
          </span>
) : null}

        <label
          htmlFor={`health-auto-refresh-${connId}`}
          style={{ fontSize: 12, color: "var(--ink-4)", marginLeft: 8 }}
        >
          {t("health.header.auto_refresh_label")}
        </label>
        <select
          id={`health-auto-refresh-${connId}`}
          data-testid="health-auto-refresh-select"
          value={dropdownValue}
          onChange={onIntervalChange}
          className="q-input"
          style={{ width: "auto", maxWidth: 110, height: 28 }}
        >
          {REFRESH_INTERVALS.map((opt) => {
            const value = opt.ms === null ? "off" : String(opt.ms);
            const capped = isCappedFor(env, opt.ms);
            const tooltip = capped
              ? t("health.refresh.cap_tooltip", { minMs: minMsForEnv(env), env })
              : undefined;
            return (              <option key={value} value={value} disabled={capped} title={tooltip}>
                {t(opt.labelKey)}
                {capped ? " ⚠" : ""}
              </option>
);
          })}
        </select>

        <button
          type="button"
          className="btn btn-sm"
          onClick={onRefreshClick}
          aria-label={t("health.header.refresh_now_aria")}
          data-testid="health-refresh-now"
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <RefreshCw
            size={13}
            className={refreshInProgress ? "animate-spin" : undefined}
            aria-hidden="true"
          />
          {t("health.header.refresh_now")}
        </button>
      </div>
    </div>
);
}

// Re-export for tests that want to assert tone classification independently.
export type { CardTone };
