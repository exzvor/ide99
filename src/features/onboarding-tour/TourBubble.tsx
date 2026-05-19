/**
 * — onboarding tour bubble.
 *
 * Auto-positioned next to the spotlight rect (below by default; flips above
 * when the rect is in the bottom half of the viewport). When `rect === null`
 * the bubble centers itself in the viewport (fallback for missing target).
 *
 * Layout:
 * ┌─────────────────────────────────────────────┐
 * │ Step N of 8                    [Skip tour] │   ← header
 * ├─────────────────────────────────────────────┤
 * │ <body copy>                                  │
 * │                                              │
 * ├─────────────────────────────────────────────┤
 * │                       [Back] [Next/Finish]  │   ← footer
 * └─────────────────────────────────────────────┘
 *
 * Tab navigation cycles within the bubble (handled by browser, focus
 * lands on Skip → Back → Next when bubble mounts; Skip is always first
 * focusable so the user can quickly bail out).
 */

import { type JSX, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { SpotlightRect } from "./SpotlightOverlay";

export interface TourBubbleProps {
  step: { id: string; body: { en: string; ru: string } };
  rect: SpotlightRect | null;
  current: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

const BUBBLE_WIDTH = 360;
const BUBBLE_GAP = 16;

interface BubblePosition {
  top: number;
  left: number;
}

function resolveBubblePosition(rect: SpotlightRect | null): BubblePosition {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  if (rect === null) {
    // Center in viewport.
    return {
      top: Math.max(16, vh / 2 - 100),
      left: Math.max(16, vw / 2 - BUBBLE_WIDTH / 2),
    };
  }

  // Default: place below the spotlight; if it would overflow viewport,
  // place above instead. Horizontally try to align with the spotlight's
  // left edge but clamp inside viewport.
  const belowTop = rect.top + rect.height + BUBBLE_GAP;
  const aboveTop = rect.top - BUBBLE_GAP - 200; // approx bubble height
  const top = belowTop + 200 < vh ? belowTop : Math.max(16, aboveTop);

  let left = rect.left;
  if (left + BUBBLE_WIDTH > vw - 16) left = vw - BUBBLE_WIDTH - 16;
  if (left < 16) left = 16;

  return { top: Math.max(16, top), left };
}

export function TourBubble(props: TourBubbleProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const skipRef = useRef<HTMLButtonElement>(null);

  const lng = (i18n.language ?? "ru").startsWith("ru") ? "ru" : "en";
  const body = props.step.body[lng];

  const position = resolveBubblePosition(props.rect);

  // Focus the Skip button on mount/step-change so keyboard users can bail
  // out immediately and Tab cycles forward through Back / Next.
  useEffect(() => {
    skipRef.current?.focus();
  }, []);

  return (    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`tour-bubble-title-${props.step.id}`}
      data-testid="tour-bubble"
      data-step-id={props.step.id}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: BUBBLE_WIDTH,
        zIndex: 1001,
        background: "var(--bg-base, #fff)",
        color: "var(--ink-1, #111)",
        border: "1px solid var(--border-subtle, rgba(0,0,0,0.1))",
        borderRadius: 8,
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          id={`tour-bubble-title-${props.step.id}`}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink-3, #555)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
          data-testid="tour-bubble-progress"
        >
          {t("onboardingTour.stepProgress", {
            current: props.current,
            total: props.total,
          })}
        </span>
        <button
          ref={skipRef}
          type="button"
          onClick={props.onSkip}
          className="btn btn-ghost"
          data-testid="tour-bubble-skip"
          style={{ fontSize: 12, padding: "4px 8px" }}
        >
          {t("onboardingTour.skip")}
        </button>
      </header>

      <p
        data-testid="tour-bubble-body"
        style={{
          fontSize: 14,
          lineHeight: 1.5,
          margin: 0,
          color: "var(--ink-1, #111)",
        }}
      >
        {body}
      </p>

      <footer
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={props.onPrev}
          disabled={props.isFirst}
          className="btn btn-ghost"
          data-testid="tour-bubble-prev"
        >
          {t("onboardingTour.previous")}
        </button>
        {props.isLast ? (          <button
            type="button"
            onClick={props.onFinish}
            className="btn btn-primary"
            data-testid="tour-bubble-finish"
          >
            {t("onboardingTour.finish")}
          </button>
) : (          <button
            type="button"
            onClick={props.onNext}
            className="btn btn-primary"
            data-testid="tour-bubble-next"
          >
            {t("onboardingTour.next")}
          </button>
)}
      </footer>
    </div>
);
}
