import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { ModuleId } from "./types";

/**
 * — universal "Upgrade to <module>" banner.
 *
 * Used by every slot component when the user lacks an active subscription.
 * /D refine per-slot copy via `ctaKey` override.
 */
export function UpgradeBanner({
  module,
  upgradeUrl,
  ctaKey,
}: {
  module: ModuleId;
  upgradeUrl: string;
  ctaKey?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const labelKey = ctaKey ?? `paid_modules.upgrade.${module}.cta`;
  return (    <div
      role="note"
      data-testid={`upgrade-banner-${module}`}
      style={{
        display: "inline-flex",
        gap: 8,
        alignItems: "center",
        padding: "6px 10px",
        border: "1px dashed var(--accent, #6366f1)",
        borderRadius: 4,
        background: "var(--accent-soft, rgba(99,102,241,0.08))",
        fontSize: 12,
      }}
    >
      <span>{t(`paid_modules.${module}.short_name`)}</span>
      <a
        href={upgradeUrl}
        target="_blank"
        rel="noreferrer noopener"
        style={{ color: "var(--accent, #6366f1)", fontWeight: 600 }}
      >
        {t(labelKey)}
      </a>
    </div>
);
}
