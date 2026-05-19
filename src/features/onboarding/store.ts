// Single-step onboarding wizard zustand store.
//
// Mounts only when `app_settings.onboarding_completed === false`. The
// user picks a mode (Easy / Standard) or skips, the backend flips the
// flag, and the wizard never re-mounts. There is no mid-flow persisted
// state to restore (the wizard is a single screen now), so the legacy
// localStorage progress key is migrated away on first read — leaving
// it would re-hydrate the wizard onto a removed `tour-handoff` step.

import { create } from "zustand";

import type { OnboardingStep, WizardState } from "./types";

const LEGACY_STORAGE_KEY = "ide99:onboarding:progress-v1";

function clearLegacyProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // best effort
  }
}

const initialState: WizardState = {
  step: "welcome",
  mode: null,
};

type Actions = {
  setStep: (step: OnboardingStep) => void;
  setMode: (mode: "easy" | "standard") => void;
  reset: () => void;
};

export const useOnboarding = create<WizardState & Actions>((set) => {
  clearLegacyProgress();
  return {
    ...initialState,
    setStep: (step) => set({ step }),
    setMode: (mode) => set({ mode }),
    reset: () => set(initialState),
  };
});
