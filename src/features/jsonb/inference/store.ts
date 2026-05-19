import { create } from "zustand";

import {
  type Fqn,
  jsonbInferenceInvalidate,
  jsonbInferenceRequest,
  subscribeJsonbInference,
} from "../../../lib/tauri";

import { type Entry, type FqnKey, fqnKey } from "./types";

interface State {
  byKey: Record<FqnKey, Entry>;
  pendingCallbacks: Record<FqnKey, Array<() => void>>;
  initialized: boolean;
  unsubscribe: (() => void) | null;
  /** Idempotent — multiple components can call init(); only the first one subscribes. */
  init: () => Promise<void>;
  request: (connId: string, fqn: Fqn, onReady?: () => void) => void;
  invalidate: (connId: string, fqn: Fqn) => Promise<void>;
  /** Returns ready or stale schema, null otherwise (pending/error/missing). */
  getCached: (connId: string, fqn: Fqn) => import("../../../lib/tauri").InferredSchema | null;
}

export const useJsonbInference = create<State>((set, get) => ({
  byKey: {},
  pendingCallbacks: {},
  initialized: false,
  unsubscribe: null,

  async init() {
    if (get().initialized) return;
    // Mark initialized BEFORE awaiting so a concurrent caller observes the flag.
    set({ initialized: true });
    const off = await subscribeJsonbInference(
      ({ connId, fqn, schema }) => {
        const key = fqnKey(connId, fqn);
        set((s) => ({ byKey: { ...s.byKey, [key]: { status: "ready", schema } } }));
        const cbs = get().pendingCallbacks[key] ?? [];
        if (cbs.length > 0) {
          set((s) => ({ pendingCallbacks: { ...s.pendingCallbacks, [key]: [] } }));
          cbs.forEach((cb) => cb());
        }
      },
      ({ connId, fqn, message }) => {
        const key = fqnKey(connId, fqn);
        set((s) => ({ byKey: { ...s.byKey, [key]: { status: "error", message } } }));
      },
    );
    set({ unsubscribe: off });
  },

  request(connId, fqn, onReady) {
    const key = fqnKey(connId, fqn);
    const existing = get().byKey[key];

    // If callback provided AND we don't yet have a usable schema, queue it.
    const needsCallback =
      onReady !== undefined &&
      (!existing || existing.status === "pending" || existing.status === "stale");
    if (needsCallback) {
      set((s) => ({
        pendingCallbacks: {
          ...s.pendingCallbacks,
          [key]: [...(s.pendingCallbacks[key] ?? []), onReady!],
        },
      }));
    }
    // Mark as pending while we wait (only if no entry yet).
    if (!existing) {
      set((s) => ({ byKey: { ...s.byKey, [key]: { status: "pending" } } }));
    }

    void jsonbInferenceRequest(connId, fqn).then(
      (res) => {
        if (res.status === "ready") {
          set((s) => ({ byKey: { ...s.byKey, [key]: { status: "ready", schema: res.schema } } }));
          const cbs = get().pendingCallbacks[key] ?? [];
          if (cbs.length > 0) {
            set((s) => ({ pendingCallbacks: { ...s.pendingCallbacks, [key]: [] } }));
            cbs.forEach((cb) => cb());
          }
        } else if (res.status === "stale") {
          set((s) => ({ byKey: { ...s.byKey, [key]: { status: "stale", schema: res.schema } } }));
        }
        // pending: leave the placeholder; the event listener will overwrite.
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        set((s) => ({ byKey: { ...s.byKey, [key]: { status: "error", message } } }));
      },
    );
  },

  async invalidate(connId, fqn) {
    const key = fqnKey(connId, fqn);
    set((s) => {
      const next = { ...s.byKey };
      delete next[key];
      return { byKey: next };
    });
    try {
      await jsonbInferenceInvalidate(connId, fqn);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      set((s) => ({ byKey: { ...s.byKey, [key]: { status: "error", message } } }));
      return;
    }
    get().request(connId, fqn);
  },

  getCached(connId, fqn) {
    const key = fqnKey(connId, fqn);
    const e = get().byKey[key];
    if (e && (e.status === "ready" || e.status === "stale")) {
      return e.schema;
    }
    return null;
  },
}));
