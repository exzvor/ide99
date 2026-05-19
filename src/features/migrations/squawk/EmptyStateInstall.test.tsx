/**
 * —
 *
 * EmptyStateInstall renders a banner with a platform-aware install
 * command and a Copy button. Translations are stubbed; clipboard is
 * stubbed via Object.defineProperty.
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const FAKE_DICT: Record<string, string> = {
  "migrations.squawk.installBanner.title": "Squawk linter not installed",
  "migrations.squawk.installBanner.body": "Install for inline migration lint:",
  "migrations.squawk.installBanner.copy": "Copy",
  "migrations.squawk.installBanner.copied": "Copied",
  "migrations.squawk.installBanner.dismiss": "Hide",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => FAKE_DICT[key] ?? key,
  }),
}));

import { EmptyStateInstall } from "./EmptyStateInstall";

describe("EmptyStateInstall", () => {
  it("renders the OS-appropriate install command", () => {
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    render(<EmptyStateInstall onDismiss={() => {}} />);
    expect(screen.getByText(/brew install squawk/i)).toBeInTheDocument();
  });

  it("Copy button writes the install command to navigator.clipboard", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<EmptyStateInstall onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("cargo install squawk-cli"));
  });
});
