// — Health screen "Reproduce on disposable DB" action.
//
// md §5.3: each slow-query row gets an
// action button. With subscription it dispatches the template-picker event
// pre-filled with the "project + sample data" preset. Without subscription
// it routes to the upgrade page directly (no dialog clutter for the user
// who hasn't bought the module).

import { FlaskConical } from "lucide-react";
import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { TemplatePickerOpenDetail } from "./Spg99TemplatePickerDialog";
import { usePaidModules } from "./store";
import { sendFeatureEvent } from "./telemetry";

export function ReproduceOnDisposableButton({
  /** SQL of the slow query — currently only used for telemetry / future
   * pre-population of a query buffer in the picked Instant DB. */
  query,
}: {
  query: string;
}): JSX.Element {
  const { t } = useTranslation();
  const subscription = usePaidModules((s) => s.subscription);
  const hydrate = usePaidModules((s) => s.hydrate);

  useEffect(() => {
    if (!subscription) void hydrate();
  }, [subscription, hydrate]);

  const subscribed = subscription?.spg99Subscribed ?? false;
  const upgradeUrl = subscription?.upgradeUrlSpg99 ?? "https://spg99.ru/instant-db";

  const onClick = () => {
    if (!subscribed) {
      sendFeatureEvent("paid_modules.spg99.reproduce.upgrade_click");
      if (typeof window !== "undefined") {
        window.open(upgradeUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    sendFeatureEvent("paid_modules.spg99.reproduce.open_picker");
    const detail: TemplatePickerOpenDetail = {
      preset: "project",
      source: `health.slow_query:${query.slice(0, 40)}`,
    };
    window.dispatchEvent(new CustomEvent("ide99:spg99:open-template-picker", { detail }));
  };

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="spg99-reproduce-on-disposable"
      data-subscribed={subscribed}
      aria-label={t("paid_modules.spg99.reproduce.aria_label")}
      title={
        subscribed
          ? t("paid_modules.spg99.reproduce.button_label")
          : t("paid_modules.spg99.reproduce.upgrade_tooltip")
      }
      className="btn btn-ghost"
      style={{
        display: "inline-flex",
        gap: 4,
        alignItems: "center",
        fontSize: 11,
        padding: "2px 8px",
      }}
    >
      <FlaskConical size={11} aria-hidden="true" />
      {t("paid_modules.spg99.reproduce.button_label")}
    </button>
  );
}
