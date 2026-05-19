/**
 * — PrivacyPanel tests.
 *
 * - toggles invoke `settings_set` IPC with the right delta
 * - "Clear my data" wipes the UUID + flips both toggles off
 * - "What we collect" button opens the secondary modal
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrivacyPanel } from "../PrivacyPanel";
import { useAppSettings } from "../store";
import type { AppSettings } from "../types";

const baseSettings: AppSettings = {
  telemetryEnabled: true,
  crashReportsEnabled: true,
  telemetryEndpoint: "eu",
  deviceUuid: "device-uuid-fixture",
  onboardingCompleted: true,
  privacyChoiceMade: true,
  privacyChoiceMadeAt: "2026-05-07T00:00:00Z",
  releaseChannel: "stable",
  lastUpdateCheckAt: null,
  spg99Subscribed: false,
  vibepgSubscribed: false,
  createdAt: "2026-05-07T00:00:00Z",
  updatedAt: "2026-05-07T00:00:00Z",
};

const cleared: AppSettings = {
  ...baseSettings,
  telemetryEnabled: false,
  crashReportsEnabled: false,
  deviceUuid: null,
  privacyChoiceMade: false,
};

const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "settings_get") return { ...baseSettings };
  if (cmd === "settings_set") return args?.settings as AppSettings;
  if (cmd === "settings_clear") return { ...cleared };
  if (cmd === "telemetry_known_events") return ["app_launched", "feature_used"];
  return null;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) =>
    invokeMock(args[0] as string, args[1] as Record<string, unknown> | undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        if ("defaultValue" in opts) {
          return String(opts.defaultValue ?? key);
        }
        if ("uuid" in opts) {
          return `Device ID: ${String(opts.uuid)}`;
        }
      }
      return key;
    },
  }),
}));

describe("PrivacyPanel", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useAppSettings.setState({
      settings: { ...baseSettings },
      loaded: true,
      loading: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders panel when settings hydrated", () => {
    render(<PrivacyPanel />);
    expect(screen.getByTestId("privacy-panel")).toBeInTheDocument();
    expect(screen.getByTestId("privacy-telemetry-toggle")).toBeChecked();
    expect(screen.getByTestId("privacy-crash-toggle")).toBeChecked();
  });

  it("telemetry toggle invokes settings_set with telemetryEnabled=false", async () => {
    const user = userEvent.setup();
    render(<PrivacyPanel />);
    await user.click(screen.getByTestId("privacy-telemetry-toggle"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({ telemetryEnabled: false }) as Partial<AppSettings>,
        }),
);
    });
  });

  it("crash toggle invokes settings_set with crashReportsEnabled=false", async () => {
    const user = userEvent.setup();
    render(<PrivacyPanel />);
    await user.click(screen.getByTestId("privacy-crash-toggle"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({ crashReportsEnabled: false }) as Partial<AppSettings>,
        }),
);
    });
  });

  it("endpoint select invokes settings_set with the new endpoint", async () => {
    const user = userEvent.setup();
    render(<PrivacyPanel />);
    await user.selectOptions(screen.getByTestId("privacy-endpoint"), "ru");
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({ telemetryEndpoint: "ru" }) as Partial<AppSettings>,
        }),
);
    });
  });

  it("clear-all requires typing confirmation, then invokes settings_clear and wipes UUID", async () => {
    const user = userEvent.setup();
    render(<PrivacyPanel />);
    expect(screen.getByText(/device-uuid-fixture/)).toBeInTheDocument();

    await user.click(screen.getByTestId("privacy-clear-all"));
    // Confirmation modal opens; clear-all must NOT have run yet.
    expect(invokeMock).not.toHaveBeenCalledWith("settings_clear", undefined);

    // Type the expected token (mocked t() returns the i18n key as-is).
    const typedInput = screen.getByLabelText("privacy.clear_all_confirm.type_prompt");
    await user.type(typedInput, "privacy.clear_all_confirm.expected_token");
    await user.click(screen.getByRole("button", { name: "privacy.clear_all_confirm.confirm" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("settings_clear", undefined);
    });
    await waitFor(() => {
      expect(screen.queryByText(/device-uuid-fixture/)).not.toBeInTheDocument();
    });
  });

  it("'what we collect' opens the event-list modal", async () => {
    const user = userEvent.setup();
    render(<PrivacyPanel />);
    await user.click(screen.getByTestId("privacy-what-we-collect"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("telemetry_known_events", undefined),
);
    await screen.findByTestId("event-app_launched");
  });
});
