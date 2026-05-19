/**
 * — VibepgAgentModeToggle tests.
 *
 * 1. Without subscription: Agent radio is aria-disabled, tooltip explains.
 * 2. Without subscription: clicking Agent fires telemetry + opens upgrade.
 * 3. With subscription: clicking Agent calls onModeChange("agent").
 * 4. Quick is always selectable; aria-checked reflects mode.
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

import { VibepgAgentModeToggle } from "./VibepgAgentModeToggle";

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

describe("VibepgAgentModeToggle (S37)", () => {
  it("Agent button is aria-disabled and shows lock tooltip without subscription", () => {
    setSubscription(false);
    render(<VibepgAgentModeToggle mode="quick" onModeChange={() => {}} />);
    const agent = screen.getByTestId("ai-mode-agent");
    expect(agent).toHaveAttribute("aria-disabled", "true");
    expect(agent).toHaveAttribute("title", expect.stringMatching(/vibepg|подписк/i));
  });

  it("clicking Agent without subscription fires telemetry + opens upgrade page", async () => {
    setSubscription(false);
    const onModeChange = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();

    render(<VibepgAgentModeToggle mode="quick" onModeChange={onModeChange} />);
    await user.click(screen.getByTestId("ai-mode-agent"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(onModeChange).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(      "https://vibepg.ai/upgrade",
      "_blank",
      "noopener,noreferrer",
);
    expect(invokeMock).toHaveBeenCalledWith("telemetry_send_event", {
      name: "feature_used",
      props: { feature_id: "paid_modules.vibepg.agent_mode.upgrade_click" },
    });
    openSpy.mockRestore();
  });

  it("clicking Agent with subscription switches mode", async () => {
    setSubscription(true);
    const onModeChange = vi.fn();
    const user = userEvent.setup();

    render(<VibepgAgentModeToggle mode="quick" onModeChange={onModeChange} />);
    await user.click(screen.getByTestId("ai-mode-agent"));
    expect(onModeChange).toHaveBeenCalledWith("agent");
  });

  it("aria-checked reflects current mode (Quick selected by default)", () => {
    setSubscription(true);
    render(<VibepgAgentModeToggle mode="quick" onModeChange={() => {}} />);
    expect(screen.getByTestId("ai-mode-quick")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("ai-mode-agent")).toHaveAttribute("aria-checked", "false");
  });
});
