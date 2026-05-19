/**
 * v1.0 GA — onboarding store unit tests.
 *
 * The store collapsed from a 4-step persisted wizard to a single-screen
 * mode picker (→ v1.0). The legacy `progress-v1` localStorage
 * key is migrated away on first read so users with stale state don't
 * land on a removed step.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useOnboarding } from "../store";

const LEGACY_STORAGE_KEY = "ide99:onboarding:progress-v1";

describe("useOnboarding store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboarding.getState().reset();
  });

  it("starts at welcome step with no mode pick", () => {
    const s = useOnboarding.getState();
    expect(s.step).toBe("welcome");
    expect(s.mode).toBeNull();
  });

  it("setMode flips the mode in-memory only (no persistence)", () => {
    useOnboarding.getState().setMode("easy");
    expect(useOnboarding.getState().mode).toBe("easy");
    // The wizard is single-screen; we don't persist mid-flow state any more.
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("reset() restores defaults", () => {
    useOnboarding.getState().setMode("standard");
    useOnboarding.getState().reset();
    const s = useOnboarding.getState();
    expect(s.step).toBe("welcome");
    expect(s.mode).toBeNull();
  });

  it("ignores stale progress blob in localStorage on next setMode", () => {
    // Stash a bogus shape that points at a removed step. The store doesn't
    // read it; resetting + setting mode should still produce a clean state.
    window.localStorage.setItem(      LEGACY_STORAGE_KEY,
      JSON.stringify({ step: "tour-handoff", mode: "easy" }),
);
    useOnboarding.getState().reset();
    useOnboarding.getState().setMode("standard");
    expect(useOnboarding.getState().step).toBe("welcome");
    expect(useOnboarding.getState().mode).toBe("standard");
  });
});
