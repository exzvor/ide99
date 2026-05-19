import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { CardState } from "../store";
import { CardShell } from "./CardShell";

interface CardProps {
  connId: string;
  state: CardState;
}

function ratioTone(ratio: number): "ok" | "warn" | "danger" {
  if (ratio >= 0.8) return "danger";
  if (ratio >= 0.5) return "warn";
  return "ok";
}

/**
 * `pg_stat_activity.state` ships the raw English token
 * ("active", "idle in transaction", …); without translation the chip on
 * an RU UI reads `active: 3` and breaks the localized look. We map the
 * known tokens to i18n keys; unknown values fall through verbatim so a
 * future PG version that adds a state still renders something useful.
 */
function localizeState(
  t: (key: string, options?: { defaultValue: string }) => string,
  raw: string,
): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_|_$/g, "");
  const key = `health.card.active_connections.state.${slug}`;
  return t(key, { defaultValue: raw });
}

export function ActiveConnectionsCard({ connId, state }: CardProps): JSX.Element {
  const { t } = useTranslation();

  if (state.status !== "ready" || state.card.id !== "active_connections") {
    return <CardShell cardId="active_connections" connId={connId} state={state} />;
  }

  const data = state.card.data;
  const ratio = data.max > 0 ? data.current / data.max : 0;
  const tone = ratioTone(ratio);

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 22, fontWeight: 600 }} data-testid="active-conn-current">
        {t("health.card.active_connections.current", {
          current: data.current,
          max: data.max,
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {Object.entries(data.byState).map(([s, count]) => (
          <span
            key={s}
            data-testid="active-conn-state-chip"
            style={{
              fontSize: 11,
              padding: "1px 6px",
              borderRadius: 999,
              background: "var(--bg-2)",
              border: "1px solid var(--hairline)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {t("health.card.active_connections.by_state", {
              state: localizeState(t, s),
              count,
            })}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <CardShell
      cardId="active_connections"
      connId={connId}
      state={state}
      body={body}
      status={{ tone, tooltip: t(`health.status.${tone}`) }}
    />
  );
}
