import { Bot } from "lucide-react";
import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { usePaidModules } from "./store";
import { sendUpgradeClickTelemetry } from "./telemetry";

export type VibepgSlot = "explain_optimize" | "migration_review" | "agent_mode" | "command_palette";

/**
 * — generic vibepg slot button (used by EXPLAIN visualizer +
 * Migration apply dialog + Health screen "Reproduce on disposable" + AI
 * panel Agent-mode toggle).
 *
 * The `slot` prop drives i18n key + telemetry event name; `onAction` is
 * called only when subscribed. Without subscription: opens upgrade page
 * and fires `paid_modules.vibepg.<slot>.upgrade_click` telemetry.
 */
export function VibepgActionButton({
  slot,
  onAction,
  variant = "compact",
}: {
  slot: VibepgSlot;
  onAction?: () => void;
  /** "compact" → short label, "full" → full marketing label per slot. */
  variant?: "compact" | "full";
}): JSX.Element {
  const { t } = useTranslation();
  const subscription = usePaidModules((s) => s.subscription);
  const hydrate = usePaidModules((s) => s.hydrate);

  useEffect(() => {
    if (!subscription) void hydrate();
  }, [subscription, hydrate]);

  const subscribed = subscription?.vibepgSubscribed ?? false;
  const upgradeUrl = subscription?.upgradeUrlVibepg ?? "https://vibepg.ai/upgrade";

  const onClick = () => {
    if (subscribed) {
      onAction?.();
      return;
    }
    sendUpgradeClickTelemetry(slot);
    if (typeof window !== "undefined") {
      window.open(upgradeUrl, "_blank", "noopener,noreferrer");
    }
  };

  const labelKey =
    variant === "full" && (slot === "explain_optimize" || slot === "migration_review")
      ? `paid_modules.vibepg.${slot}.full_label`
      : `paid_modules.vibepg.${slot}.label`;
  const label = t(labelKey);

  return (    <button
      type="button"
      onClick={onClick}
      data-testid={`vibepg-${slot}`}
      data-subscribed={subscribed}
      aria-label={label}
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        padding: "4px 10px",
        border: "1px solid var(--accent, #6366f1)",
        borderRadius: 4,
        background: subscribed ? "var(--accent, #6366f1)" : "transparent",
        color: subscribed ? "var(--bg, white)" : "var(--accent, #6366f1)",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      <Bot size={12} aria-hidden="true" />
      {label}
    </button>
);
}
