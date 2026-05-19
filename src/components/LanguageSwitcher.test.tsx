import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const changeLanguageSpy = vi.fn();

// Hold the current language in module scope; the mocked useTranslation
// hooks into a per-render useState + an event channel so component re-renders
// happen the same way real react-i18next behaves on `languageChanged`.
let currentLanguage = "ru";
const subscribers = new Set<() => void>();

function setLanguage(lng: string) {
  currentLanguage = lng;
  changeLanguageSpy(lng);
  for (const cb of subscribers) cb();
}

vi.mock("react-i18next", () => ({
  useTranslation: () => {
    const [, force] = useState(0);
    useState(() => {
      const cb = () => force((n) => n + 1);
      subscribers.add(cb);
      return cb;
    });
    return {
      t: (key: string) => key,
      i18n: {
        language: currentLanguage,
        changeLanguage: (lng: string) => {
          setLanguage(lng);
          return Promise.resolve();
        },
      },
    };
  },
}));

import { LanguageSwitcher } from "./LanguageSwitcher";

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    changeLanguageSpy.mockClear();
    currentLanguage = "ru";
    subscribers.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a button with aria-label from key language.switch", () => {
    render(<LanguageSwitcher />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toContain("language.switch");
  });

  it("toggles between ru and en on click via i18n.changeLanguage", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    const button = screen.getByRole("button");

    await user.click(button);
    expect(changeLanguageSpy).toHaveBeenLastCalledWith("en");

    await user.click(button);
    expect(changeLanguageSpy).toHaveBeenLastCalledWith("ru");
  });

  it("exposes the language toggle via accessible name", () => {
    render(<LanguageSwitcher />);
    // Quiet redesign dropped the visible "en"/"ru" text hint in favour of a
    // pure-icon `q-fchip` affordance. The aria-label remains the
    // semantic anchor for assistive tech + tests.
    expect(screen.getByRole("button", { name: "language.switch" })).toBeInTheDocument();
  });
});
