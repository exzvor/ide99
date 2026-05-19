// — privacy / settings zustand store.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import type { AppSettings, CrashReport } from "./types";

type State = {
  settings: AppSettings | null;
  loaded: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
  setSettings: (next: AppSettings) => Promise<AppSettings>;
  clearAll: () => Promise<AppSettings>;
  sendEvent: (name: string, props?: Record<string, string>) => Promise<void>;
  buildCrashReport: (message: string, stack: string, appVersion: string) => Promise<CrashReport>;
  sendCrashReport: (report: CrashReport) => Promise<void>;
};

export const useAppSettings = create<State>((set, get) => ({
  settings: null,
  loaded: false,
  loading: false,

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const settings = await invoke<AppSettings>("settings_get");
      set({ settings, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  setSettings: async (next) => {
    const saved = await invoke<AppSettings>("settings_set", { settings: next });
    set({ settings: saved });
    return saved;
  },

  clearAll: async () => {
    const cleared = await invoke<AppSettings>("settings_clear");
    set({ settings: cleared });
    return cleared;
  },

  sendEvent: async (name, props = {}) => {
    // Pure no-op upstream when telemetry off — backend short-circuits.
    try {
      await invoke<void>("telemetry_send_event", { name, props });
    } catch {
      // Telemetry must NEVER break user flow.
    }
  },

  buildCrashReport: async (message, stack, appVersion) =>
    invoke<CrashReport>("crash_report_build", { message, stack, appVersion }),

  sendCrashReport: async (report) => {
    await invoke<void>("crash_report_send", { report });
  },
}));
