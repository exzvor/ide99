/**
 * v1.0 GA — OnboardingWizard tests.
 *
 * The wizard collapsed from a 4-step modal flow (welcome → connection →
 * sample-db → tour-handoff) into a single screen with three actions
 * (Standard / Easy / Skip). These tests cover the full surface:
 *
 * - hidden when settings.onboardingCompleted=true
 * - renders welcome with both mode cards + skip link
 * - Standard pick: flips onboardingCompleted, sets mode=standard, no tour
 * - Easy pick: flips onboardingCompleted, sets mode=easy, dispatches tour
 * - Skip pick: flips onboardingCompleted, no mode change, no tour
 * - ESC = Skip
 * - role=dialog + aria-modal
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../components/Toast";
import i18n from "../../../i18n";
import { useUiMode } from "../../easy-mode/store";
import { useAppSettings } from "../../privacy/store";
import { OnboardingWizard } from "../OnboardingWizard";
import { useOnboarding } from "../store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const { invoke } = await import("@tauri-apps/api/core");
const mockedInvoke = vi.mocked(invoke);

const BASE_SETTINGS = {
  telemetryEnabled: false,
  crashReportsEnabled: false,
  telemetryEndpoint: "none" as const,
  deviceUuid: null as string | null,
  onboardingCompleted: false,
  privacyChoiceMade: true,
  privacyChoiceMadeAt: "2026-05-01T00:00:00Z" as string | null,
  releaseChannel: "stable" as const,
  lastUpdateCheckAt: null as string | null,
  spg99Subscribed: false,
  vibepgSubscribed: false,
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

function ui() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <OnboardingWizard />
      </ToastProvider>
    </I18nextProvider>,
  );
}

async function hydrateAndRender(overrides: Partial<typeof BASE_SETTINGS> = {}) {
  useAppSettings.setState({
    settings: { ...BASE_SETTINGS, ...overrides },
    loaded: true,
    loading: false,
  });
  let result!: ReturnType<typeof ui>;
  await act(async () => {
    result = ui();
  });
  return result;
}

describe("OnboardingWizard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "settings_get") return { ...BASE_SETTINGS };
      if (cmd === "settings_set") {
        const a = args as { settings: typeof BASE_SETTINGS } | undefined;
        return a?.settings ?? { ...BASE_SETTINGS };
      }
      return undefined;
    });
    useOnboarding.getState().reset();
    useUiMode.setState({ mode: "standard", tourCompleted: false });
  });

  afterEach(() => {
    useAppSettings.setState({ settings: null, loaded: false, loading: false });
    useOnboarding.getState().reset();
  });

  it("returns null when onboarding already completed", async () => {
    await hydrateAndRender({ onboardingCompleted: true });
    expect(screen.queryByTestId("onboarding-wizard")).not.toBeInTheDocument();
  });

  it("renders welcome with Standard card and skip link (Easy card disabled —)", async () => {
    await hydrateAndRender();
    expect(screen.getByTestId("onboarding-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-mode-standard")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-mode-easy")).not.toBeInTheDocument();
    expect(screen.getByTestId("onboarding-skip")).toBeInTheDocument();
  });

  it("Standard pick flips onboardingCompleted and sets mode=standard, no tour", async () => {
    const tourListener = vi.fn();
    window.addEventListener("ide99:tour:start", tourListener);
    await hydrateAndRender();
    await act(async () => {
      fireEvent.click(screen.getByTestId("onboarding-mode-standard"));
    });
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({ onboardingCompleted: true }),
        }),
      );
    });
    expect(useOnboarding.getState().mode).toBe(null); // reset() clears it after finish
    expect(tourListener).not.toHaveBeenCalled();
    window.removeEventListener("ide99:tour:start", tourListener);
  });

  // Easy pick is temporarily disabled in the wizard (the ModeCard is
  // commented out —). When Easy mode comes
  // back, un-skip this test and restore the assertion list above to match.
  it.skip("Easy pick flips onboardingCompleted, sets uiMode=easy, dispatches tour", async () => {
    const tourListener = vi.fn();
    window.addEventListener("ide99:tour:start", tourListener);
    await hydrateAndRender();
    await act(async () => {
      fireEvent.click(screen.getByTestId("onboarding-mode-easy"));
    });
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({ onboardingCompleted: true }),
        }),
      );
    });
    await waitFor(() => {
      expect(tourListener).toHaveBeenCalled();
    });
    expect(useUiMode.getState().mode).toBe("easy");
    expect(useUiMode.getState().tourCompleted).toBe(false);
    window.removeEventListener("ide99:tour:start", tourListener);
  });

  it("Skip flips onboardingCompleted but does not change mode or fire tour", async () => {
    const tourListener = vi.fn();
    window.addEventListener("ide99:tour:start", tourListener);
    await hydrateAndRender();
    await act(async () => {
      fireEvent.click(screen.getByTestId("onboarding-skip"));
    });
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({ onboardingCompleted: true }),
        }),
      );
    });
    expect(tourListener).not.toHaveBeenCalled();
    expect(useUiMode.getState().mode).toBe("standard");
    window.removeEventListener("ide99:tour:start", tourListener);
  });

  it("ESC dismisses the wizard as a Skip (no tour, no mode change)", async () => {
    const tourListener = vi.fn();
    window.addEventListener("ide99:tour:start", tourListener);
    await hydrateAndRender();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({ onboardingCompleted: true }),
        }),
      );
    });
    expect(tourListener).not.toHaveBeenCalled();
    window.removeEventListener("ide99:tour:start", tourListener);
  });

  it("dialog has role=dialog and aria-modal=true", async () => {
    await hydrateAndRender();
    const dlg = screen.getByTestId("onboarding-wizard");
    expect(dlg).toHaveAttribute("role", "dialog");
    expect(dlg).toHaveAttribute("aria-modal", "true");
  });
});
