import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { usePaidModules } from "./store";

/**
 * — Settings → Modules tab.
 *
 * scaffold: read-only subscription status with "Manage" links to the
 * upstream upgrade pages. /D add per-module preferences (default
 * region / template / TTL for SPG99; model / privacy redaction for vibepg).
 */
export function ModulesSettingsPanel(): JSX.Element {
  const { t } = useTranslation();
  const subscription = usePaidModules((s) => s.subscription);
  const hydrate = usePaidModules((s) => s.hydrate);

  useEffect(() => {
    if (!subscription) void hydrate();
  }, [subscription, hydrate]);

  if (!subscription) {
    return <div style={{ padding: 16, color: "var(--ink-3)" }}>{t("paid_modules.loading")}</div>;
  }

  return (
    <section
      data-testid="modules-settings-panel"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16, maxWidth: 640 }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        {t("paid_modules.settings.title")}
      </h2>

      <article
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: 12,
          background: "var(--bg-elev)",
        }}
        data-testid="modules-settings-spg99"
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            {t("paid_modules.spg99.full_name")}
          </h3>
          <span
            style={{
              fontSize: 11,
              padding: "1px 6px",
              borderRadius: 3,
              background: subscription.spg99Subscribed ? "var(--ok, #2a7)" : "var(--ink-3)",
              color: "white",
            }}
          >
            {subscription.spg99Subscribed
              ? t("paid_modules.status.active")
              : t("paid_modules.status.inactive")}
          </span>
        </header>
        <p style={{ margin: "8px 0", fontSize: 12, color: "var(--ink-3)" }}>
          {t("paid_modules.spg99.description")}
        </p>
        <a
          href={subscription.upgradeUrlSpg99}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="modules-spg99-manage"
        >
          {t(
            subscription.spg99Subscribed
              ? "paid_modules.action.manage"
              : "paid_modules.action.upgrade",
          )}
        </a>
      </article>

      <article
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: 12,
          background: "var(--bg-elev)",
        }}
        data-testid="modules-settings-vibepg"
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            {t("paid_modules.vibepg.full_name")}
          </h3>
          <span
            style={{
              fontSize: 11,
              padding: "1px 6px",
              borderRadius: 3,
              background: subscription.vibepgSubscribed ? "var(--ok, #2a7)" : "var(--ink-3)",
              color: "white",
            }}
          >
            {subscription.vibepgSubscribed
              ? t("paid_modules.status.active")
              : t("paid_modules.status.inactive")}
          </span>
        </header>
        <p style={{ margin: "8px 0", fontSize: 12, color: "var(--ink-3)" }}>
          {t("paid_modules.vibepg.description")}
        </p>
        <a
          href={subscription.upgradeUrlVibepg}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="modules-vibepg-manage"
        >
          {t(
            subscription.vibepgSubscribed
              ? "paid_modules.action.manage"
              : "paid_modules.action.upgrade",
          )}
        </a>
      </article>
    </section>
  );
}
