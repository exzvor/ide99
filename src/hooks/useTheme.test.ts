import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, useTheme } from "./useTheme";

/**
 * matchMedia stub used to drive prefers-color-scheme behaviour. We replicate
 * the EventTarget surface useTheme depends on so we can flip the system
 * preference at will from inside tests.
 */
type MQListener = (event: { matches: boolean }) => void;

function makeMatchMediaStub(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<MQListener>();

  const mql = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, cb: MQListener) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: MQListener) => {
      listeners.delete(cb);
    },
    addListener: (cb: MQListener) => listeners.add(cb), // legacy API
    removeListener: (cb: MQListener) => listeners.delete(cb),
    dispatchEvent: () => true,
  };

  const matchMedia = vi.fn().mockImplementation(() => mql);

  return {
    matchMedia,
    setDark(next: boolean) {
      dark = next;
      for (const cb of listeners) cb({ matches: next });
    },
  };
}

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to "system" when localStorage is empty', () => {
    const { matchMedia } = makeMatchMediaStub(false);
    vi.stubGlobal("matchMedia", matchMedia);

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("system");
  });

  it("reads stored theme from localStorage on mount", () => {
    const { matchMedia } = makeMatchMediaStub(false);
    vi.stubGlobal("matchMedia", matchMedia);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it('setTheme("dark") persists to localStorage and applies data-theme on <html>', () => {
    const { matchMedia } = makeMatchMediaStub(false);
    vi.stubGlobal("matchMedia", matchMedia);

    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(result.current.resolved).toBe("dark");
  });

  it('resolves "system" against prefers-color-scheme: dark', () => {
    const { matchMedia } = makeMatchMediaStub(true);
    vi.stubGlobal("matchMedia", matchMedia);

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("system");
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it('resolves "system" against prefers-color-scheme: light', () => {
    const { matchMedia } = makeMatchMediaStub(false);
    vi.stubGlobal("matchMedia", matchMedia);

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("system");
    expect(result.current.resolved).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("subscribes to matchMedia change events when theme is system", () => {
    const stub = makeMatchMediaStub(false);
    vi.stubGlobal("matchMedia", stub.matchMedia);

    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("light");

    act(() => stub.setDark(true));

    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
