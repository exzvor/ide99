// v1.0 GA — coach-marks dismissed state.
//
// Tracks which contextual hints the user has already seen so we don't
// re-bug them. Persisted in localStorage (per-device, no backend round-
// trip — coach marks are pure UI nudges and the source of truth is the
// user's lived experience, not a server).
//
// Each mark has a stable string id ("editor-shortcuts", "result-grid-
// sort", "empty-connections-help"). `markSeen(id)` flips the flag, and
// the host component skips render when `seen(id)` is true. The set is
// monotonic — once seen, always seen — there is no "reset" outside of
// dev tools clearing localStorage. That's intentional: re-bugging power
// users with already-known hints is the worst-case UX we want to avoid.

import { create } from "zustand";

const STORAGE_KEY = "ide99:coach-marks:seen-v1";

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed))
      return new Set(parsed.filter((x): x is string => typeof x === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // best effort
  }
}

type CoachMarksState = {
  seen: Set<string>;
  isSeen: (id: string) => boolean;
  markSeen: (id: string) => void;
  /** Test-only escape hatch — production never calls this. */
  reset: () => void;
};

export const useCoachMarks = create<CoachMarksState>((set, get) => ({
  seen: readSeen(),
  isSeen: (id) => get().seen.has(id),
  markSeen: (id) => {
    const next = new Set(get().seen);
    if (next.has(id)) return;
    next.add(id);
    writeSeen(next);
    set({ seen: next });
  },
  reset: () => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // best effort
      }
    }
    set({ seen: new Set() });
  },
}));
