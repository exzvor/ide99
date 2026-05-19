/**
 * — onboarding tour host.
 *
 * Mounted once at App-level. Listens to:
 * - `useUiMode` subscribe → on `mode` flipping standard → easy when
 * `tourCompleted === false`: schedule auto-start (after a short delay
 * so the Easy-mode layout settles before we measure target rects).
 * - `ide99:tour:start` window event → manual re-trigger from Help / any
 * surface that calls `startOnboardingTour()`.
 *
 * State: a single `currentIndex` (null = inactive). Spotlight rect is
 * measured via `getBoundingClientRect()` for the resolved target selector
 * and refreshed on window resize / each step change. If the target is
 * missing, we fall back to a centered bubble + uniform dim — the tour
 * stays walkable.
 *
 * Skip / Finish both persist `tourCompleted = true` so the tour doesn't
 * re-fire on subsequent Easy-mode switches.
 */

import { type JSX, useCallback, useEffect, useState } from "react";
import { useUiMode } from "../easy-mode/store";
import { SpotlightOverlay, type SpotlightRect } from "./SpotlightOverlay";
import { TourBubble } from "./TourBubble";
import { TOUR_STEPS } from "./steps";

const TOUR_START_EVENT = "ide99:tour:start";
const AUTO_START_DELAY_MS = 300;

function measureTarget(selector: string): SpotlightRect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = (el as Element).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function TourHost(): JSX.Element | null {
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const totalSteps = TOUR_STEPS.length;
  const active = currentIndex !== null;
  const step = active ? TOUR_STEPS[currentIndex] : null;

  // Re-measure rect on step change + window resize while active.
  useEffect(() => {
    if (step === null || step === undefined) {
      setRect(null);
      return undefined;
    }
    const update = () => setRect(measureTarget(step.target));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  const finish = useCallback(() => {
    useUiMode.getState().setTourCompleted(true);
    setCurrentIndex(null);
  }, []);

  const skip = useCallback(() => {
    // Skip is morally identical to Finish — user has seen enough; mark
    // completed so the tour doesn't pop again on the next Easy-switch.
    useUiMode.getState().setTourCompleted(true);
    setCurrentIndex(null);
  }, []);

  const next = useCallback(() => {
    setCurrentIndex((prev) => {
      if (prev === null) return prev;
      if (prev >= TOUR_STEPS.length - 1) return prev;
      return prev + 1;
    });
  }, []);

  const prev = useCallback(() => {
    setCurrentIndex((p) => {
      if (p === null) return p;
      if (p <= 0) return p;
      return p - 1;
    });
  }, []);

  // Manual trigger via window event (Help → Restart tour).
  useEffect(() => {
    const handler = () => setCurrentIndex(0);
    window.addEventListener(TOUR_START_EVENT, handler);
    return () => window.removeEventListener(TOUR_START_EVENT, handler);
  }, []);

  // Auto-start when `mode` flips standard → easy and tour not yet completed.
  // We use a short delay so layout transitions (Workspace re-render in Easy
  // mode) settle before we measure the first target rect.
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = useUiMode.subscribe((state, prev) => {
      if (prev.mode === "standard" && state.mode === "easy" && !state.tourCompleted) {
        timer = window.setTimeout(() => {
          setCurrentIndex(0);
        }, AUTO_START_DELAY_MS);
      }
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  // ESC = skip while active. Bound at document so the editor / dialogs
  // don't swallow it before we see it.
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        skip();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [active, skip]);

  if (!active || step === null || step === undefined) return null;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === TOUR_STEPS.length - 1;

  return (    <div data-testid="tour-host" data-tour-step={step.id}>
      <SpotlightOverlay rect={rect} />
      <TourBubble
        step={{ id: step.id, body: step.body }}
        rect={rect}
        current={(currentIndex ?? 0) + 1}
        total={totalSteps}
        isFirst={isFirst}
        isLast={isLast}
        onPrev={prev}
        onNext={next}
        onSkip={skip}
        onFinish={finish}
      />
    </div>
);
}

/** Imperative re-trigger — wired to Help menu (or any other surface). */
export function startOnboardingTour(): void {
  window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
}
