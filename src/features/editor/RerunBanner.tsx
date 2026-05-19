// src/features/editor/RerunBanner.tsx
import { useTranslation } from "react-i18next";

export interface RerunBannerProps {
  onRerun(): void;
  onDismiss(): void;
}

export function RerunBanner({ onRerun, onDismiss }: RerunBannerProps) {
  const { t } = useTranslation();
  return (    <div
      className="rerun-banner"
      // biome-ignore lint/a11y/useSemanticElements: interactive status banner with action buttons; <output> loses the action affordance + dismiss styling hook.
      role="status"
    >
      <span>{t("filter.rerunHint", { defaultValue: "Filter applied. Re-run query?" })}</span>
      <button type="button" onClick={onRerun}>
        ▶ {t("filter.rerun", { defaultValue: "Re-run" })}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rerun-banner-dismiss"
        aria-label={t("filter.dismiss", { defaultValue: "Dismiss" })}
      >
        ×
      </button>
    </div>
);
}
