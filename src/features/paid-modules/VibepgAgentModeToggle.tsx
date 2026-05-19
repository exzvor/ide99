// — AI panel "Quick / Agent" toggle.
//
// md §6.4: when the user has a vibepg
// subscription, the AI panel offers a binary mode pick at the top:
//
// ◉ Quick (free AI)   ○ Agent (vibepg)
//
// Without subscription, the Agent tab is rendered but disabled, with a
// tooltip "Requires vibepg subscription". Clicking Agent in that state
// opens the upgrade page (default `VibepgActionButton` behavior — we
// fire telemetry directly here since we render our own elements).

import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { usePaidModules } from "./store";
import { sendUpgradeClickTelemetry } from "./telemetry";

export type AiMode = "quick" | "agent";

interface Props {
  mode: AiMode;
  onModeChange(next: AiMode): void;
}

export function VibepgAgentModeToggle({ mode, onModeChange }: Props): JSX.Element {
  const { t } = useTranslation();
  const subscription = usePaidModules((s) => s.subscription);
  const hydrate = usePaidModules((s) => s.hydrate);

  useEffect(() => {
    if (!subscription) void hydrate();
  }, [subscription, hydrate]);

  const subscribed = subscription?.vibepgSubscribed ?? false;
  const upgradeUrl = subscription?.upgradeUrlVibepg ?? "https://vibepg.ai/upgrade";

  const onAgentClick = () => {
    if (subscribed) {
      onModeChange("agent");
      return;
    }
    sendUpgradeClickTelemetry("agent_mode");
    if (typeof window !== "undefined") {
      window.open(upgradeUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (    <div
      // biome-ignore lint/a11y/useSemanticElements: <fieldset> would force a visual border / legend; this is a 2-button toolbar group, not a form field set.
      role="group"
      aria-label={t("paid_modules.vibepg.agent_mode_toggle.aria_label")}
      data-testid="vibepg-agent-mode-toggle"
      style={{
        display: "inline-flex",
        gap: 0,
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        overflow: "hidden",
        fontSize: 12,
        background: "var(--bg-elev)",
      }}
    >
      <button
        type="button"
        // biome-ignore lint/a11y/useSemanticElements: native <input type="radio"> can't carry rich content + custom border styling; aria-checked / aria-pressed give the same semantics.
        role="radio"
        aria-checked={mode === "quick"}
        aria-pressed={mode === "quick"}
        data-testid="ai-mode-quick"
        onClick={() => onModeChange("quick")}
        title={t("paid_modules.vibepg.agent_mode_toggle.quick_hint")}
        style={{
          padding: "6px 12px",
          background: mode === "quick" ? "var(--accent, #6366f1)" : "transparent",
          color: mode === "quick" ? "var(--bg, white)" : "var(--ink-2)",
          border: 0,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        {mode === "quick" ? "◉" : "○"} {t("paid_modules.vibepg.agent_mode_toggle.quick")}
      </button>
      <button
        type="button"
        // biome-ignore lint/a11y/useSemanticElements: see Quick button above — same custom radio rationale.
        role="radio"
        aria-checked={mode === "agent" && subscribed}
        aria-pressed={mode === "agent" && subscribed}
        aria-disabled={!subscribed}
        data-testid="ai-mode-agent"
        data-subscribed={subscribed}
        onClick={onAgentClick}
        title={
          subscribed
            ? t("paid_modules.vibepg.agent_mode_toggle.agent_hint")
            : t("paid_modules.vibepg.agent_mode_toggle.agent_locked_tooltip")
        }
        style={{
          padding: "6px 12px",
          background: subscribed && mode === "agent" ? "var(--accent, #6366f1)" : "transparent",
          color:
            subscribed && mode === "agent"
              ? "var(--bg, white)"
              : subscribed
                ? "var(--ink-2)"
                : "var(--ink-4)",
          border: 0,
          borderLeft: "1px solid var(--hairline)",
          cursor: "pointer",
          fontSize: 12,
          opacity: subscribed ? 1 : 0.7,
        }}
      >
        {subscribed && mode === "agent" ? "◉" : "○"}{" "}
        {t("paid_modules.vibepg.agent_mode_toggle.agent")}
      </button>
    </div>
);
}
