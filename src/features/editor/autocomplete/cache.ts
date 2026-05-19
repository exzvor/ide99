import { create } from "zustand";
import { type AutocompleteSnapshot, schemaGetAutocompleteSnapshot } from "../../../lib/tauri";

interface State {
  snapshots: Record<string, AutocompleteSnapshot>;
  inflight: Record<string, Promise<AutocompleteSnapshot | undefined>>;
  errors: Record<string, string>;
}

interface Actions {
  loadSnapshot: (    connId: string,
    onResolved?: () => void,
) => Promise<AutocompleteSnapshot | undefined>;
  refresh: (connId: string) => Promise<AutocompleteSnapshot | undefined>;
  evict: (connId: string) => void;
  getSnapshot: (connId: string) => AutocompleteSnapshot | undefined;
}

export const useAutocompleteCache = create<State & Actions>((set, get) => ({
  snapshots: {},
  inflight: {},
  errors: {},

  getSnapshot: (connId) => get().snapshots[connId],

  evict: (connId) => {
    set((s) => {
      const snapshots = { ...s.snapshots };
      const errors = { ...s.errors };
      delete snapshots[connId];
      delete errors[connId];
      return { snapshots, errors };
    });
  },

  loadSnapshot: async (connId, onResolved) => {
    const cached = get().snapshots[connId];
    if (cached) {
      onResolved?.();
      return cached;
    }
    const inflight = get().inflight[connId];
    if (inflight) {
      const r = await inflight;
      onResolved?.();
      return r;
    }
    const promise = (async () => {
      try {
        const snap = await schemaGetAutocompleteSnapshot(connId);
        set((s) => ({
          snapshots: { ...s.snapshots, [connId]: snap },
          errors: stripKey(s.errors, connId),
        }));
        return snap;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set((s) => ({ errors: { ...s.errors, [connId]: msg } }));
        return undefined;
      } finally {
        set((s) => ({ inflight: stripKey(s.inflight, connId) }));
      }
    })();
    set((s) => ({ inflight: { ...s.inflight, [connId]: promise } }));
    const result = await promise;
    onResolved?.();
    return result;
  },

  refresh: async (connId) => {
    set((s) => ({ snapshots: stripKey(s.snapshots, connId) }));
    return get().loadSnapshot(connId);
  },
}));

function stripKey<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
}
