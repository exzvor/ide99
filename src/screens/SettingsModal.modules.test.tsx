/**
 * — SettingsModal Modules tab smoke test ().
 *
 * Verifies that the Modules tab is mounted between MCP and Privacy and
 * renders the ModulesSettingsPanel.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../i18n";
import { usePaidModules } from "../features/paid-modules/store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Stub heavy panels so we test the tab wiring, not their internals.
vi.mock("../features/snippets/SettingsSnippets", () => ({
  SettingsSnippets: () => <div data-testid="stub-snippets" />,
}));
vi.mock("../features/mcp/SettingsMcp", () => ({
  SettingsMcp: () => <div data-testid="stub-mcp" />,
}));
vi.mock("../features/privacy/PrivacyPanel", () => ({
  PrivacyPanel: () => <div data-testid="stub-privacy" />,
}));

import { SettingsModal, openSettings } from "./SettingsModal";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    spg99Subscribed: false,
    vibepgSubscribed: false,
    upgradeUrlSpg99: "https://spg99.ru/instant-db",
    upgradeUrlVibepg: "https://vibepg.ai/upgrade",
  });
  usePaidModules.setState({
    subscription: {
      spg99Subscribed: false,
      vibepgSubscribed: false,
      upgradeUrlSpg99: "https://spg99.ru/instant-db",
      upgradeUrlVibepg: "https://vibepg.ai/upgrade",
    },
    loaded: true,
    loading: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsModal — Modules tab (S37)", () => {
  it("renders a Modules tab between MCP and Privacy and shows the panel", async () => {
    const user = userEvent.setup();
    render(<SettingsModal />);
    openSettings("modules");

    // Modal opens via window event; wait for tab list to appear.
    const trigger = await screen.findByRole("tab", { name: /modules|модули/i });
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByTestId("modules-settings-panel")).toBeInTheDocument();
    });

    // Sanity: SPG99 + vibepg cards present.
    expect(screen.getByTestId("modules-settings-spg99")).toBeInTheDocument();
    expect(screen.getByTestId("modules-settings-vibepg")).toBeInTheDocument();
  });
});
