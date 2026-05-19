import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import { usePaidModules } from "./store";

/**
 * — status-bar widget for active SPG99 Instant DB.
 *
 * scaffold: renders nothing when no active Instant DB connection.
 * (zustand subscription
 * to connection store + ephemeral metadata). For now exposes the slot.
 */
export function Spg99StatusBarWidget({
  activeInstantDb,
}: {
  activeInstantDb: { template: string; expiresInMinutes: number } | null;
}): JSX.Element | null {
  const { t } = useTranslation();
  const subscribed = usePaidModules((s) => s.subscription?.spg99Subscribed ?? false);

  if (!subscribed || !activeInstantDb) return null;

  return (
    <span
      data-testid="spg99-status-bar"
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        fontSize: 11,
        color: "var(--ok, #2a7)",
      }}
    >
      <span aria-hidden="true">●</span>
      {t("paid_modules.spg99.status_bar", {
        template: activeInstantDb.template,
        minutes: activeInstantDb.expiresInMinutes,
      })}
    </span>
  );
}
