// — updater zustand store.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import type { CheckResult, ProgressEvent, ReleaseChannel } from "./types";

type State = {
  currentVersion: string | null;
  lastResult: CheckResult | null;
  checking: boolean;
  /// True between Approve and the final `done` progress event.
  installing: boolean;
  /// Last progress payload received on `updater:progress`.
  progress: ProgressEvent | null;
  /// User decision on the Available banner — null until they pick.
  decision: "approved" | "deferred" | null;
  loadCurrentVersion: () => Promise<string>;
  check: () => Promise<CheckResult>;
  installPending: () => Promise<void>;
  manifestUrl: (channel: ReleaseChannel) => Promise<string>;
  setProgress: (p: ProgressEvent | null) => void;
  setDecision: (d: "approved" | "deferred" | null) => void;
  reset: () => void;
};

export const useUpdater = create<State>((set, get) => ({
  currentVersion: null,
  lastResult: null,
  checking: false,
  installing: false,
  progress: null,
  decision: null,

  loadCurrentVersion: async () => {
    if (get().currentVersion) return get().currentVersion!;
    const v = await invoke<string>("updater_current_version");
    set({ currentVersion: v });
    return v;
  },

  check: async () => {
    set({ checking: true, decision: null, progress: null });
    try {
      const result = await invoke<CheckResult>("updater_check");
      set({ lastResult: result });
      return result;
    } finally {
      set({ checking: false });
    }
  },

  installPending: async () => {
    set({ installing: true, decision: "approved" });
    try {
      await invoke<void>("updater_install_pending");
    } finally {
      set({ installing: false });
    }
  },

  manifestUrl: async (channel) => invoke<string>("updater_manifest_url", { channel }),

  setProgress: (p) => set({ progress: p }),

  setDecision: (d) => set({ decision: d }),

  reset: () =>
    set({
      lastResult: null,
      installing: false,
      progress: null,
      decision: null,
    }),
}));
