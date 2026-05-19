/**
 * — UI mode store.
 *
 * Two modes:
 * - "standard" (default for all existing + new users)
 * - "easy" (opt-in via header toggle, mandatory tour on first switch)
 *
 * Persists to localStorage (`ide99:ui:mode`) so the choice survives
 * restart. Subscribes drive layout, tooltip visibility, the
 * BidirectionalSqlPanel, and the easy-linter activation.
 *
 * Easy mode is currently TEMPORARILY DISABLED at the UI level
 *. The store keeps its original shape so
 * existing tests and consumers compile, but the production runtime forces
 * `mode: "standard"` on boot and after rehydration. The actions remain
 * functional so tests can drive the store directly via setState.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UiMode = "easy" | "standard";

export interface UiModeState {
  mode: UiMode;
  /** Whether the onboarding tour has completed at least once.
   * Tour is mandatory on the first switch to Easy mode; afterwards
   * the user can re-trigger it from Help. */
  tourCompleted: boolean;
  setMode: (mode: UiMode) => void;
  setTourCompleted: (done: boolean) => void;
  toggleMode: () => void;
}

const STORAGE_KEY = "ide99:ui:mode-v1";

export const useUiMode = create<UiModeState>()(  persist(    (set, get) => ({
      mode: "standard",
      tourCompleted: false,
      setMode: (mode) => set({ mode }),
      setTourCompleted: (tourCompleted) => set({ tourCompleted }),
      toggleMode: () => set({ mode: get().mode === "easy" ? "standard" : "easy" }),
    }),
    {
      name: STORAGE_KEY,
      // Easy mode is temporarily disabled. If a user has `mode: "easy"`
      // persisted from a previous session, snap them back to standard on
      // load so they don't end up in a UI surface they can no longer toggle
      // away from (the toggle button and Cmd/Ctrl+Shift+E are both hidden).
      onRehydrateStorage: () => (state) => {
        if (state && state.mode !== "standard") {
          state.mode = "standard";
        }
      },
    },
),
);

/** True when the user is currently in Easy mode — used as a feature gate by
 * the linter, tour, and panel components. */
export function isEasyMode(): boolean {
  return useUiMode.getState().mode === "easy";
}
