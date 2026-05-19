import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object" && "defaultValue" in opts) {
        return String((opts as { defaultValue: unknown }).defaultValue);
      }
      return key;
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

import { RerunBanner } from "./RerunBanner";

describe("<RerunBanner />", () => {
  it("renders the rerun hint text", () => {
    render(<RerunBanner onRerun={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/Filter applied\. Re-run query\?/i)).toBeInTheDocument();
  });

  it("invokes onRerun when the Re-run button is clicked", () => {
    const onRerun = vi.fn();
    const onDismiss = vi.fn();
    render(<RerunBanner onRerun={onRerun} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /Re-run/i }));
    expect(onRerun).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("invokes onDismiss when the dismiss (×) button is clicked", () => {
    const onRerun = vi.fn();
    const onDismiss = vi.fn();
    render(<RerunBanner onRerun={onRerun} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onRerun).not.toHaveBeenCalled();
  });
});
