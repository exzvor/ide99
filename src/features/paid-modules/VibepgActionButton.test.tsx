/**
 * — VibepgActionButton.
 *
 * scaffold ships the component (open upgrade page when not subscribed,
 * call `onAction` when subscribed). These tests cover the additions:
 *
 * 1. Telemetry fires on upgrade click (not on subscribed click).
 * 2. `variant="full"` switches to the marketing label for slots that have one.
 * 3. Subscribed click invokes onAction and does NOT open a new tab.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../i18n";
import { usePaidModules } from "./store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { VibepgActionButton } from "./VibepgActionButton";

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
  // reset the zustand store between tests
  usePaidModules.setState({ subscription: null, loaded: false, loading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VibepgActionButton (S37)", () => {
  it("fires telemetry and opens upgrade URL when not subscribed", async () => {
    setSubscription(false);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();

    render(<VibepgActionButton slot="explain_optimize" />);
    await user.click(screen.getByTestId("vibepg-explain_optimize"));

    // Wait a microtask for the void invoke().catch() to be scheduled.
    await act(async () => {
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      "https://vibepg.ai/upgrade",
      "_blank",
      "noopener,noreferrer",
    );
    expect(invokeMock).toHaveBeenCalledWith("telemetry_send_event", {
      name: "feature_used",
      props: { feature_id: "paid_modules.vibepg.explain_optimize.upgrade_click" },
    });
    openSpy.mockRestore();
  });

  it("invokes onAction (no upgrade page, no telemetry) when subscribed", async () => {
    setSubscription(true);
    const onAction = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();

    render(<VibepgActionButton slot="migration_review" onAction={onAction} />);
    await user.click(screen.getByTestId("vibepg-migration_review"));

    expect(onAction).toHaveBeenCalledOnce();
    expect(openSpy).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("renders the full marketing label when variant=full", () => {
    setSubscription(true);
    render(<VibepgActionButton slot="explain_optimize" variant="full" />);
    expect(screen.getByTestId("vibepg-explain_optimize")).toHaveAccessibleName(
      /measure-based optimize|оптимизировать с замерами/i,
    );
  });

  it("falls back to compact label by default", () => {
    setSubscription(true);
    render(<VibepgActionButton slot="explain_optimize" />);
    const btn = screen.getByTestId("vibepg-explain_optimize");
    expect(btn).toHaveAccessibleName(/vibepg optimize|vibepg оптимизировать/i);
  });
});
