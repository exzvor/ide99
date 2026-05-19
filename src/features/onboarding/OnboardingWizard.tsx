import { type JSX, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useUiMode } from "../easy-mode/store";
import { useAppSettings } from "../privacy/store";
import { useOnboarding } from "./store";

/**
 * v1.0 GA — single-screen onboarding.
 *
 * Renders only when `settings.onboardingCompleted === false`. Three
 * dismiss paths, all flip `onboardingCompleted=true`:
 *
 * - "Standard"  → standard mode, no tour
 * - "Easy"      → easy mode + dispatch `ide99:tour:start` so the
 * 8-step S33 tour walks through the UI
 * - "Skip"      → no mode change, no tour, straight to ide99
 *
 * The 4-step wizard (welcome → connection → sample-db →
 * tour-handoff) was retired because it stacked ~13 interrupt screens
 * before the user could touch the IDE (telemetry modal + 4 wizard
 * steps + 8 tour bubbles). Connection picking and sample-DB live as
 * inline coach-marks in the empty connection list now (`features/
 * onboarding-coach-marks`).
 *
 * A11y:
 * - role="dialog" + aria-modal="true"
 * - focus trap: Tab cycles within the wizard
 * - title heading gets focus on mount
 * - ESC dismisses (treated as Skip — no mode change, no tour)
 */
export function OnboardingWizard(): JSX.Element | null {
  const { t } = useTranslation();

  const settings = useAppSettings((s) => s.settings);
  const hydrate = useAppSettings((s) => s.hydrate);
  const setSettings = useAppSettings((s) => s.setSettings);

  const setMode = useOnboarding((s) => s.setMode);
  const reset = useOnboarding((s) => s.reset);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!settings) void hydrate();
  }, [settings, hydrate]);

  // �� wait until the user has made a privacy choice. Otherwise the
  // privacy opt-in modal and the onboarding wizard render simultaneously and
  // the coach mark behind them is also visible. Sequence is strict:
  // privacy → onboarding → coach marks.
  const visible =
    !!settings && settings.privacyChoiceMade === true && settings.onboardingCompleted === false;

  // Focus the title on mount so a screen reader announces the dialog
  // and the user lands inside the focus trap.
  useEffect(() => {
    if (!visible) return;
    titleRef.current?.focus();
  }, [visible]);

  // Tab focus trap.
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible]);

  const finish = useCallback(    async (pick: "standard" | "easy" | "skip") => {
      if (!settings) return;
      await setSettings({ ...settings, onboardingCompleted: true });
      if (pick === "easy") {
        setMode("easy");
        useUiMode.getState().setMode("easy");
        useUiMode.getState().setTourCompleted(false);
        window.dispatchEvent(new CustomEvent("ide99:tour:start"));
      } else if (pick === "standard") {
        setMode("standard");
      }
      reset();
    },
    [settings, setSettings, setMode, reset],
);

  // ESC = skip (no mode change, no tour). Capture-phase so we win over
  // any nested handler.
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      void finish("skip");
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [visible, finish]);

  if (!visible || !settings) return null;

  return (    // biome-ignore lint/a11y/useSemanticElements: native <dialog> can't host our focus-trap + non-portal overlay; we keep div+role parity with other v1.0 modals.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      data-testid="onboarding-wizard"
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        zIndex: 90,
      }}
    >
      <div
        style={{
          background: "var(--bg-elev)",
          color: "var(--fg)",
          padding: 28,
          borderRadius: 12,
          maxWidth: 520,
          minWidth: 440,
          boxShadow: "var(--shadow-xl)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h2
          id="onboarding-title"
          ref={titleRef}
          tabIndex={-1}
          style={{ margin: 0, fontSize: 18, fontWeight: 600, outline: "none" }}
        >
          {t("onboarding.welcome.title")}
        </h2>

        <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
          {t("onboarding.welcome.body")}
        </p>

        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 10,
          }}
        >
          <ModeCard
            testId="onboarding-mode-standard"
            title={t("onboarding.welcome.standard")}
            desc={t("onboarding.welcome.standard_desc")}
            onClick={() => void finish("standard")}
            recommended
          />
          {/* Easy mode option temporarily disabled — see
              Standard is now the only positive
              action; Skip remains below. */}
          {/* <ModeCard
            testId="onboarding-mode-easy"
            title={t("onboarding.welcome.easy")}
            desc={t("onboarding.welcome.easy_desc")}
            onClick={() => void finish("easy")}
            recommended
          /> */}
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            data-testid="onboarding-skip"
            onClick={() => void finish("skip")}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--ink-3)",
              fontSize: 12,
              cursor: "pointer",
              padding: "4px 8px",
              textDecoration: "underline",
            }}
          >
            {t("onboarding.welcome.skip")}
          </button>
        </div>
      </div>
    </div>
);
}

interface ModeCardProps {
  testId: string;
  title: string;
  desc: string;
  onClick: () => void;
  recommended?: boolean;
}

function ModeCard({ testId, title, desc, onClick, recommended }: ModeCardProps): JSX.Element {
  return (    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        position: "relative",
        textAlign: "left",
        padding: 14,
        border: recommended ? "1px solid var(--accent)" : "1px solid var(--hairline)",
        borderRadius: 8,
        background: recommended ? "var(--accent-soft)" : "var(--bg)",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: "pointer",
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      <span style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>{desc}</span>
    </button>
);
}
