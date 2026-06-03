import { useCallback, useEffect, useState } from "react";

/**
 * Theme handling hook.
 *
 * The user-visible setting is one of "light" | "dark" | "system" — the latter
 * defers to the OS via `prefers-color-scheme`. The hook always returns a
 * concrete `resolved` value ("light" | "dark") so callers don't have to
 * re-implement the system preference branching.
 *
 * Side effects:
 * - Persists `theme` in localStorage under `ide99:theme`.
 * - Mirrors `resolved` into `document.documentElement.dataset.theme`, which
 * is what `themes.css` keys off of via `[data-theme="dark"]`.
 * - Subscribes to the OS preference change while `theme === "system"` and
 * unsubscribes once the user picks an explicit theme.
 */

export type Theme = "light" | "dark" | "system" | "high-contrast";
export type ResolvedTheme = "light" | "dark" | "high-contrast";

export const THEME_STORAGE_KEY = "ide99:theme";

/** Cycle order shared by the on-screen switcher and the View → Toggle Theme
 * menu item so both step through the same sequence. */
export const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "high-contrast",
  "high-contrast": "light",
};

/** Fired when the theme changes outside a component's own `setTheme` (e.g. the
 * native menu's Toggle Theme) so every mounted `useTheme` re-reads and stays in
 * sync. */
export const THEME_CHANGE_EVENT = "ide99:theme-change";

const VALID_THEMES: readonly Theme[] = ["light", "dark", "system", "high-contrast"];

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && (VALID_THEMES as readonly string[]).includes(raw)) {
      return raw as Theme;
    }
  } catch {
    // Storage may throw in privacy / sandboxed contexts — fall back to system.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
  // Note: "high-contrast" passes through unchanged — it's an explicit user
  // choice (Settings → Accessibility), not derived from the OS preference.
}

/**
 * Advance to the next theme and persist it (issue #12). Safe to call from
 * non-React code such as the native View → Toggle Theme menu listener: it
 * writes localStorage, mirrors the resolved value onto `<html data-theme>`
 * immediately, and notifies every mounted `useTheme` via `THEME_CHANGE_EVENT`.
 */
export function cycleTheme(): void {
  if (typeof window === "undefined") return;
  const next = NEXT_THEME[readStoredTheme()];
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Best-effort; storage may be unavailable in sandboxed contexts.
  }
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolveTheme(next, systemPrefersDark());
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}

export interface UseThemeResult {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark());

  // Subscribe to OS-level preference changes only while in "system" mode —
  // once the user has picked a concrete theme, the OS preference is irrelevant.
  useEffect(() => {
    if (theme !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(mql.matches);

    const onChange = (event: { matches: boolean }) => {
      setPrefersDark(event.matches);
    };

    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, [theme]);

  const resolved = resolveTheme(theme, prefersDark);

  // Mirror resolved theme onto <html data-theme=...> so themes.css can apply.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  // Re-read when the theme is changed elsewhere (the native Toggle Theme menu,
  // another useTheme instance, or another window) so all instances agree.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      setThemeState(readStoredTheme());
      setPrefersDark(systemPrefersDark());
    };
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Best-effort; surfacing a storage error to the user would be obnoxious.
    }
    // Notify other useTheme instances (editor, menu listener) to re-sync.
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
  }, []);

  return { theme, resolved, setTheme };
}
