/**
 * — opt-in dialog tests (acceptance criterion #1).
 *
 * Verifies:
 * - dialog only renders when `privacyChoiceMade === false`
 * - "accept" → telemetryEnabled=true, crashReportsEnabled=true,
 * privacyChoiceMade=true
 * - "decline" → both flags false, privacyChoiceMade=true
 * - "what we collect" opens secondary modal listing events
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelemetryOptInDialog } from "../TelemetryOptInDialog";
import { useAppSettings } from "../store";
import type { AppSettings } from "../types";

const baseSettings: AppSettings = {
  telemetryEnabled: false,
  crashReportsEnabled: false,
  telemetryEndpoint: "eu",
  deviceUuid: null,
  onboardingCompleted: false,
  privacyChoiceMade: false,
  privacyChoiceMadeAt: null,
  releaseChannel: "stable",
  lastUpdateCheckAt: null,
  spg99Subscribed: false,
  vibepgSubscribed: false,
  createdAt: "2026-05-07T00:00:00Z",
  updatedAt: "2026-05-07T00:00:00Z",
};

const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "settings_get") return { ...baseSettings };
  if (cmd === "settings_set") return args?.settings as AppSettings;
  if (cmd === "telemetry_known_events") {
    return ["app_launched", "feature_used", "privacy_choice_made"];
  }
  return null;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) =>
    invokeMock(args[0] as string, args[1] as Record<string, unknown> | undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object" && "defaultValue" in opts) {
        return String(opts.defaultValue ?? key);
      }
      return key;
    },
  }),
}));

describe("TelemetryOptInDialog", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useAppSettings.setState({ settings: null, loaded: false, loading: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when settings are not yet hydrated", () => {
    const { container } = render(<TelemetryOptInDialog />);
    // Effect kicks off hydrate but the dialog should not flash without state.
    expect(container.querySelector("[data-testid='telemetry-opt-in']")).toBeNull();
  });

  it("renders nothing when privacyChoiceMade === true", async () => {
    useAppSettings.setState({
      settings: { ...baseSettings, privacyChoiceMade: true },
      loaded: true,
    });
    render(<TelemetryOptInDialog />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("telemetry-opt-in")).not.toBeInTheDocument();
  });

  it("renders when privacyChoiceMade === false", async () => {
    useAppSettings.setState({ settings: { ...baseSettings }, loaded: true });
    render(<TelemetryOptInDialog />);
    await screen.findByTestId("opt-in-accept");
    expect(screen.getByTestId("opt-in-decline")).toBeInTheDocument();
    expect(screen.getByTestId("opt-in-what")).toBeInTheDocument();
  });

  it("renders the body paragraph only once (regression: was duplicated as Dialog description + child)", async () => {
    useAppSettings.setState({ settings: { ...baseSettings }, loaded: true });
    render(<TelemetryOptInDialog />);
    await screen.findByTestId("opt-in-accept");
    // The mocked t() function returns the key verbatim, so look for the
    // body key occurrence count. Pre-fix it appeared twice (description
    // prop + <p> child), now exactly once.
    const matches = screen.getAllByText("privacy.opt_in.body");
    expect(matches).toHaveLength(1);
  });

  it("accept → telemetryEnabled=true, crashReportsEnabled=true, privacyChoiceMade=true", async () => {
    useAppSettings.setState({ settings: { ...baseSettings }, loaded: true });
    const user = userEvent.setup();
    render(<TelemetryOptInDialog />);
    await user.click(await screen.findByTestId("opt-in-accept"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({
            telemetryEnabled: true,
            crashReportsEnabled: true,
            privacyChoiceMade: true,
          }) as Partial<AppSettings>,
        }),
);
    });
  });

  it("decline → both flags false, privacyChoiceMade=true", async () => {
    useAppSettings.setState({ settings: { ...baseSettings }, loaded: true });
    const user = userEvent.setup();
    render(<TelemetryOptInDialog />);
    await user.click(await screen.findByTestId("opt-in-decline"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({
            telemetryEnabled: false,
            crashReportsEnabled: false,
            privacyChoiceMade: true,
          }) as Partial<AppSettings>,
        }),
);
    });
  });

  it("'what we collect' button opens the event-list modal", async () => {
    useAppSettings.setState({ settings: { ...baseSettings }, loaded: true });
    const user = userEvent.setup();
    render(<TelemetryOptInDialog />);
    await user.click(await screen.findByTestId("opt-in-what"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("telemetry_known_events", undefined),
);
    await screen.findByTestId("event-app_launched");
    expect(screen.getByTestId("event-feature_used")).toBeInTheDocument();
  });
});
