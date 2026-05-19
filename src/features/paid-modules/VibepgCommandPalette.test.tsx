/**
 * — VibepgCommandPalette tests.
 *
 * 1. Renders all 7 commands when open + empty filter.
 * 2. Filter narrows the list (case-insensitive, label OR hint match).
 * 3. Clicking an item without subscription fires telemetry + opens upgrade.
 * 4. Clicking an item with subscription invokes onSelect with command id.
 * 5. Keyboard ArrowDown + Enter selects active item.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

import { usePaidModules } from "./store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { VIBEPG_COMMANDS, VibepgCommandPalette } from "./VibepgCommandPalette";

function setSubscription(vibepgSubscribed: boolean) {
  usePaidModules.setState({
    subscription: {
      spg99Subscribed: false,
      vibepgSubscribed,
      upgradeUrlSpg99: "https://spg99.ru/instant-db",
      upgradeUrlVibepg: "https://vibepg.ai/upgrade",
    },
    loaded: true,
    loading: false,
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  usePaidModules.setState({ subscription: null, loaded: false, loading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VibepgCommandPalette (S37)", () => {
  it("renders every spec'd command when open with empty query", () => {
    setSubscription(false);
    render(<VibepgCommandPalette open={true} onOpenChange={() => {}} />);
    for (const id of VIBEPG_COMMANDS) {
      expect(screen.getByTestId(`vibepg-command-item-${id}`)).toBeInTheDocument();
    }
    expect(VIBEPG_COMMANDS.length).toBe(7);
  });

  it("filters the list by query (label OR hint match)", async () => {
    setSubscription(false);
    const user = userEvent.setup();
    render(<VibepgCommandPalette open={true} onOpenChange={() => {}} />);

    await user.type(screen.getByTestId("vibepg-command-input"), "rollback");
    expect(screen.getByTestId("vibepg-command-item-rollback_plan")).toBeInTheDocument();
    expect(screen.queryByTestId("vibepg-command-item-suggest_index")).not.toBeInTheDocument();
  });

  it("shows the empty-state hint when nothing matches", async () => {
    setSubscription(false);
    const user = userEvent.setup();
    render(<VibepgCommandPalette open={true} onOpenChange={() => {}} />);
    await user.type(screen.getByTestId("vibepg-command-input"), "zzz_does_not_exist_anywhere");
    expect(screen.getByTestId("vibepg-command-empty")).toBeInTheDocument();
  });

  it("clicking item without subscription fires telemetry + opens upgrade page", async () => {
    setSubscription(false);
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();

    render(<VibepgCommandPalette open={true} onOpenChange={onOpenChange} onSelect={onSelect} />);
    await user.click(screen.getByTestId("vibepg-command-item-suggest_index"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(
      "https://vibepg.ai/upgrade",
      "_blank",
      "noopener,noreferrer",
    );
    expect(invokeMock).toHaveBeenCalledWith("telemetry_send_event", {
      name: "feature_used",
      props: { feature_id: "paid_modules.vibepg.command_palette.upgrade_click" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    openSpy.mockRestore();
  });

  it("clicking item with subscription invokes onSelect", async () => {
    setSubscription(true);
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<VibepgCommandPalette open={true} onOpenChange={onOpenChange} onSelect={onSelect} />);
    await user.click(screen.getByTestId("vibepg-command-item-fix_sql_error"));
    expect(onSelect).toHaveBeenCalledWith("fix_sql_error");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ArrowDown + Enter selects the next item", async () => {
    setSubscription(true);
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<VibepgCommandPalette open={true} onOpenChange={() => {}} onSelect={onSelect} />);
    const input = screen.getByTestId("vibepg-command-input");
    input.focus();
    await user.keyboard("{ArrowDown}{Enter}");
    // First item is `check_migration`; ArrowDown moves to `fix_sql_error`.
    expect(onSelect).toHaveBeenCalledWith("fix_sql_error");
  });
});
