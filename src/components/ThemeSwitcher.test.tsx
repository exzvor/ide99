import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock react-i18next so the component renders without an i18next instance and
// so we can assert exactly which keys it tries to translate (the mocked t()
// returns the key verbatim).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && "current" in opts) return `${key}:${String(opts.current)}`;
      return key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

// Stub matchMedia for the underlying useTheme hook (it always queries it).
function stubMatchMedia(prefersDark = false) {
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal(    "matchMedia",
    vi.fn().mockImplementation(() => mql),
);
}

import { ThemeSwitcher } from "./ThemeSwitcher";

describe("ThemeSwitcher", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a button with an aria-label derived from theme.toggle.label", () => {
    render(<ThemeSwitcher />);
    const button = screen.getByRole("button");
    // Mocked t() returns "theme.toggle.label:<current>"; we only care that the
    // label key is present so a real translator can render the right string.
    expect(button.getAttribute("aria-label")).toContain("theme.toggle.label");
  });

  it("uses the system Monitor icon when theme starts as system", () => {
    render(<ThemeSwitcher />);
    const icon = screen.getByTestId("theme-icon");
    expect(icon.dataset.themeIcon).toBe("system");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("cycles light -> dark -> system -> high-contrast -> light on successive clicks", async () => {
    // Pre-set theme to "light" so cycle order is deterministic.
    window.localStorage.setItem("ide99:theme", "light");
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole("button");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByTestId("theme-icon").dataset.themeIcon).toBe("light");

    await user.click(button);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTestId("theme-icon").dataset.themeIcon).toBe("dark");

    await user.click(button);
    // theme="system" — resolved = light (matchMedia stubbed to !prefersDark)
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByTestId("theme-icon").dataset.themeIcon).toBe("system");

    await user.click(button);
    // S35 — high-contrast is an explicit theme, never derived; both the icon
    // marker and the data-theme attribute reflect it directly.
    expect(document.documentElement.dataset.theme).toBe("high-contrast");
    expect(screen.getByTestId("theme-icon").dataset.themeIcon).toBe("high-contrast");

    await user.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByTestId("theme-icon").dataset.themeIcon).toBe("light");
  });
});
