/**
 * — ReproduceOnDisposableButton tests ().
 *
 * Covers:
 * 1. Not subscribed → click opens upgrade page + fires telemetry.
 * 2. Subscribed → click dispatches `ide99:spg99:open-template-picker`
 * with `preset: "project"` and a `source` annotation.
 * 3. The button has an aria-label (icon-only) for screen readers.
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

import { ReproduceOnDisposableButton } from "../ReproduceOnDisposableButton";
import type { TemplatePickerOpenDetail } from "../Spg99TemplatePickerDialog";

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

describe("ReproduceOnDisposableButton", () => {
  it("not subscribed → opens upgrade page + fires telemetry", async () => {
    setSubscription(false);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const user = userEvent.setup();

    render(<ReproduceOnDisposableButton query="SELECT 1" />);
    await user.click(screen.getByTestId("spg99-reproduce-on-disposable"));

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
      props: { feature_id: "paid_modules.spg99.reproduce.upgrade_click" },
    });
    // No template-picker dispatch when not subscribed.
    const dispatched = dispatchSpy.mock.calls.find(
      ([e]) => e instanceof CustomEvent && e.type === "ide99:spg99:open-template-picker",
    );
    expect(dispatched).toBeUndefined();
    openSpy.mockRestore();
  });

  it("subscribed → dispatches open-template-picker with project preset", async () => {
    setSubscription(true);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const user = userEvent.setup();

    render(<ReproduceOnDisposableButton query="SELECT * FROM orders WHERE id = 1" />);
    await user.click(screen.getByTestId("spg99-reproduce-on-disposable"));

    expect(openSpy).not.toHaveBeenCalled();
    const evt = dispatchSpy.mock.calls
      .map(([e]) => e)
      .find(
        (e): e is CustomEvent<TemplatePickerOpenDetail> =>
          e instanceof CustomEvent && e.type === "ide99:spg99:open-template-picker",
      );
    expect(evt).toBeDefined();
    expect(evt?.detail.preset).toBe("project");
    expect(evt?.detail.source).toContain("health.slow_query:");
    openSpy.mockRestore();
  });

  it("renders an aria-label for screen readers (icon-button)", () => {
    setSubscription(true);
    render(<ReproduceOnDisposableButton query="SELECT 1" />);
    const btn = screen.getByTestId("spg99-reproduce-on-disposable");
    expect(btn).toHaveAttribute("aria-label");
    expect(btn.getAttribute("aria-label")).toBeTruthy();
  });
});
