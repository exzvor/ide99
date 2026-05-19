// — paid-module zustand store.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import type { ActionPreflight, ModuleId, SubscriptionState } from "./types";

type State = {
  subscription: SubscriptionState | null;
  loaded: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
  preFlight: (module: ModuleId) => Promise<ActionPreflight>;
  /** Convenience: synchronous predicate cached on `subscription`. Renders
   * default-deny if hydration hasn't happened yet. */
  isSubscribed: (module: ModuleId) => boolean;
};

export const usePaidModules = create<State>((set, get) => ({
  subscription: null,
  loaded: false,
  loading: false,

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const subscription = await invoke<SubscriptionState>("modules_get_state");
      set({ subscription, loaded: true });
    } catch {
      // Tauri IPC may not be available in tests / web preview / first paint
      // before backend boot. We silently leave `subscription = null`; slot
      // components fall back to the unsubscribed branch (default-deny).
    } finally {
      set({ loading: false });
    }
  },

  preFlight: async (module) => invoke<ActionPreflight>("modules_pre_flight", { module }),

  isSubscribed: (module) => {
    const sub = get().subscription;
    if (!sub) return false;
    return module === "spg99" ? sub.spg99Subscribed : sub.vibepgSubscribed;
  },
}));
