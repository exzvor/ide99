import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

vi.mock("../components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <button type="button">language-switcher</button>,
}));

vi.mock("../components/ThemeSwitcher", () => ({
  ThemeSwitcher: () => <button type="button">theme-switcher</button>,
}));

vi.mock("../features/connections/EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state">empty-state</div>,
}));

vi.mock("../components/quiet/Mesh", () => ({
  Mesh: () => <div data-testid="mesh" />,
}));

vi.mock("../components/quiet/Particles", () => ({
  Particles: () => <canvas data-testid="particles" tabIndex={-1} />,
}));

vi.mock("../components/quiet/Titlebar", () => ({
  Titlebar: () => <div data-testid="titlebar" />,
}));

vi.mock("../components/quiet/Wordmark", () => ({
  Wordmark: ({ size }: { size?: string }) => (    <span data-testid={`wordmark-${size ?? "lg"}`} aria-label="ide99">
      ide99
    </span>
),
}));

import Welcome from "./Welcome";

describe("Welcome", () => {
  test("renders the ide99 wordmark via the quiet brand component", () => {
    render(<Welcome />);
    const wordmark = screen.getByTestId("wordmark-lg");
    expect(wordmark).toHaveAccessibleName("ide99");
  });

  test("renders the i18n-translated tagline", () => {
    render(<Welcome />);
    expect(screen.getByText("welcome.tagline")).toBeInTheDocument();
  });

  test("renders the EmptyState component (S2 replacement for the hint)", () => {
    render(<Welcome />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  test("<main> has role='main' and aria-labelledby pointing to the welcome heading", () => {
    render(<Welcome />);
    const main = screen.getByRole("main");
    const labelledById = main.getAttribute("aria-labelledby");
    expect(labelledById).toBeTruthy();
    const heading = labelledById ? document.getElementById(labelledById) : null;
    expect(heading).not.toBeNull();
    expect(heading).toHaveTextContent("welcome.tagline");
  });

  test("includes the language and theme switchers", () => {
    render(<Welcome />);
    expect(screen.getByText("language-switcher")).toBeInTheDocument();
    expect(screen.getByText("theme-switcher")).toBeInTheDocument();
  });
});
