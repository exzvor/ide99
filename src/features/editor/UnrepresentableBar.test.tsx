import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // The test mock just echoes the key — for `unrepresentableHint` we
      // splice the interpolated reason into the rendered text so the bar
      // still has a recognizable signature for assertions.
      if (        key === "filter.unrepresentableHint" &&
        opts &&
        typeof opts === "object" &&
        "reason" in opts
) {
        return `[hint:${String((opts as { reason: unknown }).reason)}]`;
      }
      if (opts && typeof opts === "object" && "defaultValue" in opts) {
        return String((opts as { defaultValue: unknown }).defaultValue);
      }
      return key;
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

import { UnrepresentableBar } from "./UnrepresentableBar";

describe("<UnrepresentableBar />", () => {
  it("renders the localized hint with the resolved reason key", () => {
    render(<UnrepresentableBar slug="group-by" />);
    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent("⚠");
    expect(bar).toHaveTextContent("[hint:filter.unrepresentableReason.group_by]");
  });

  it("falls back to the raw slug for unknown reasons", () => {
    render(<UnrepresentableBar slug="brand-new-slug" />);
    expect(screen.getByRole("status")).toHaveTextContent("[hint:brand-new-slug]");
  });

  it("renders nothing for no-from (scalar SELECT)", () => {
    const { container } = render(<UnrepresentableBar slug="no-from" />);
    expect(container).toBeEmptyDOMElement();
  });
});
