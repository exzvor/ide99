/**
 * — Spg99TemplatePickerDialog tests ().
 *
 * Covers:
 * 1. Closed by default; opens on `ide99:spg99:open-template-picker`.
 * 2. Ignores the open-event when user is not subscribed.
 * 3. Pre-selects the `preset` template when provided.
 * 4. Renders all six template radios + auto-stop + TTL inputs.
 * 5. Cancel closes dialog without firing telemetry.
 * 6. Create fires `feature_used` telemetry with the chosen template id
 * and closes the dialog (v1.0 stub — no real backend).
 * 7. Renders the v1.0-disabled-note (acceptance criterion: visible w/o
 * end-to-end backend).
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import { usePaidModules } from "../store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { Spg99TemplatePickerDialog } from "../Spg99TemplatePickerDialog";

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

function dispatchOpen(detail?: { preset?: string; source?: string }): void {
  act(() => {
    window.dispatchEvent(new CustomEvent("ide99:spg99:open-template-picker", { detail }));
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

describe("Spg99TemplatePickerDialog", () => {
  it("does not render when no open event has fired (closed by default)", () => {
    setSubscription(true);
    const { queryByTestId } = render(<Spg99TemplatePickerDialog />);
    expect(queryByTestId("spg99-template-picker")).toBeNull();
  });

  it("does not open when user is not subscribed", () => {
    setSubscription(false);
    const { queryByTestId } = render(<Spg99TemplatePickerDialog />);
    dispatchOpen();
    expect(queryByTestId("spg99-template-picker")).toBeNull();
  });

  it("opens with all six templates when subscribed", async () => {
    setSubscription(true);
    render(<Spg99TemplatePickerDialog />);
    dispatchOpen();
    await waitFor(() => {
      expect(screen.getByTestId("spg99-template-picker")).toBeInTheDocument();
    });
    for (const tpl of ["clean", "pgvector", "postgis", "timescale", "project", "custom"]) {
      expect(screen.getByTestId(`spg99-template-radio-${tpl}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("spg99-template-picker-auto-stop")).toBeInTheDocument();
    expect(screen.getByTestId("spg99-template-picker-ttl")).toBeInTheDocument();
    expect(screen.getByTestId("spg99-template-picker-v1-note")).toBeInTheDocument();
  });

  it("pre-selects the preset template when provided in event detail", async () => {
    setSubscription(true);
    render(<Spg99TemplatePickerDialog />);
    dispatchOpen({ preset: "pgvector" });
    await waitFor(() => {
      expect(screen.getByTestId("spg99-template-picker")).toBeInTheDocument();
    });
    expect(screen.getByTestId("spg99-template-radio-pgvector")).toBeChecked();
    expect(screen.getByTestId("spg99-template-radio-clean")).not.toBeChecked();
  });

  it("Cancel closes the dialog without firing telemetry", async () => {
    setSubscription(true);
    const user = userEvent.setup();
    render(<Spg99TemplatePickerDialog />);
    dispatchOpen();
    await waitFor(() => screen.getByTestId("spg99-template-picker"));
    await user.click(screen.getByTestId("spg99-template-picker-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("spg99-template-picker")).toBeNull();
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("Create fires feature_used telemetry and closes the dialog (v1.0 stub)", async () => {
    setSubscription(true);
    const user = userEvent.setup();
    render(<Spg99TemplatePickerDialog />);
    dispatchOpen({ preset: "postgis" });
    await waitFor(() => screen.getByTestId("spg99-template-picker"));
    await user.click(screen.getByTestId("spg99-template-picker-create"));

    // Wait for queueMicrotask + telemetry catch chain.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("telemetry_send_event", {
      name: "feature_used",
      props: { feature_id: "paid_modules.spg99.template_picker.create.postgis" },
    });
    await waitFor(() => {
      expect(screen.queryByTestId("spg99-template-picker")).toBeNull();
    });
  });

  it("changes the selected template on radio click", async () => {
    setSubscription(true);
    const user = userEvent.setup();
    render(<Spg99TemplatePickerDialog />);
    dispatchOpen();
    await waitFor(() => screen.getByTestId("spg99-template-picker"));
    expect(screen.getByTestId("spg99-template-radio-clean")).toBeChecked();
    await user.click(screen.getByTestId("spg99-template-radio-timescale"));
    expect(screen.getByTestId("spg99-template-radio-timescale")).toBeChecked();
    expect(screen.getByTestId("spg99-template-radio-clean")).not.toBeChecked();
  });
});
