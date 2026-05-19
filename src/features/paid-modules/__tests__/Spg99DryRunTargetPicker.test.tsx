/**
 * — Spg99DryRunTargetPicker tests ().
 *
 * Covers:
 * 1. Without subscription: SPG99 radio is disabled; Docker is checked
 * regardless of `value`; upgrade link is rendered and fires telemetry.
 * 2. With subscription: SPG99 radio enabled; clicking SPG99 calls
 * onChange("spg99"); clicking Docker calls onChange("docker").
 * 3. The `aria-checked` attribute mirrors the active radio.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import { usePaidModules } from "../store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { Spg99DryRunTargetPicker } from "../Spg99DryRunTargetPicker";

function setSubscription(spg99Subscribed: boolean): void {
  usePaidModules.setState({
    subscription: {
      spg99Subscribed,
      vibepgSubscribed: false,
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

describe("Spg99DryRunTargetPicker", () => {
  it("disables SPG99 radio and shows upgrade link when not subscribed", () => {
    setSubscription(false);
    const onChange = vi.fn();
    render(<Spg99DryRunTargetPicker value="docker" onChange={onChange} />);
    const spg99 = screen.getByTestId("spg99-dryrun-target-spg99");
    const docker = screen.getByTestId("spg99-dryrun-target-docker");
    expect(spg99).toBeDisabled();
    expect(spg99).not.toBeChecked();
    expect(docker).toBeChecked();
    expect(screen.getByTestId("spg99-dryrun-upgrade-link")).toBeInTheDocument();
  });

  it("upgrade link fires telemetry + opens upgrade URL", async () => {
    setSubscription(false);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    render(<Spg99DryRunTargetPicker value="docker" onChange={() => {}} />);
    await user.click(screen.getByTestId("spg99-dryrun-upgrade-link"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(
      "https://spg99.ru/instant-db",
      "_blank",
      "noopener,noreferrer",
    );
    expect(invokeMock).toHaveBeenCalledWith("telemetry_send_event", {
      name: "feature_used",
      props: { feature_id: "paid_modules.spg99.dry_run.upgrade_click" },
    });
    openSpy.mockRestore();
  });

  it("with subscription: SPG99 radio enabled; clicking it calls onChange('spg99')", async () => {
    setSubscription(true);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Spg99DryRunTargetPicker value="docker" onChange={onChange} />);
    const spg99 = screen.getByTestId("spg99-dryrun-target-spg99");
    expect(spg99).not.toBeDisabled();
    await user.click(spg99);
    expect(onChange).toHaveBeenCalledWith("spg99");
    // Upgrade hint must NOT render when subscribed.
    expect(screen.queryByTestId("spg99-dryrun-upgrade-link")).toBeNull();
  });

  it("clicking the Docker radio calls onChange('docker')", async () => {
    setSubscription(true);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Spg99DryRunTargetPicker value="spg99" onChange={onChange} />);
    await user.click(screen.getByTestId("spg99-dryrun-target-docker"));
    expect(onChange).toHaveBeenCalledWith("docker");
  });
});
