/**
 * — UpdateChecker tests.
 *
 * - renders current version + idle state
 * - "Check for updates" populates lastResult
 * - upToDate result renders the up-to-date banner
 * - available result renders release notes + Approve/Defer
 * - Approve → invokes updater_install_pending and subscribes to progress
 * - progress events drive the progress bar percentage
 * - Defer hides the install buttons in favour of the deferred banner
 * - Channel selector calls settings_set with the new releaseChannel
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppSettings } from "../../privacy/store";
import type { AppSettings } from "../../privacy/types";
import { UpdateChecker } from "../UpdateChecker";
import { useUpdater } from "../store";
import type { CheckResult, ProgressEvent as UpdaterProgressEvent } from "../types";

// ─── Tauri invoke mock ───────────────────────────────────────────────────────

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// ─── Tauri event listener mock ───────────────────────────────────────────────

type Listener<T> = (event: { payload: T }) => void;
const eventListeners = new Map<string, Set<Listener<unknown>>>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, cb: Listener<unknown>) => {
    let bucket = eventListeners.get(eventName);
    if (!bucket) {
      bucket = new Set();
      eventListeners.set(eventName, bucket);
    }
    bucket.add(cb);
    return () => bucket?.delete(cb);
  }),
}));

function emit(eventName: string, payload: unknown) {
  const bucket = eventListeners.get(eventName);
  if (!bucket) return;
  for (const cb of bucket) cb({ payload });
}

// ─── i18n mock ───────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Render templated keys with their interpolation values so assertions
      // can match on the placeholder values and the test reads naturally.
      if (opts) {
        const entries = Object.entries(opts).filter(([k]) => k !== "defaultValue");
        if (entries.length) {
          return `${key}|${entries.map(([k, v]) => `${k}=${String(v)}`).join(",")}`;
        }
      }
      return key;
    },
  }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseSettings: AppSettings = {
  telemetryEnabled: false,
  crashReportsEnabled: false,
  telemetryEndpoint: "eu",
  deviceUuid: null,
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

const upToDateResult: CheckResult = {
  kind: "upToDate",
  currentVersion: "1.0.0",
  channel: "stable",
  checkedAt: "2026-05-07T00:00:00Z",
};

const availableResult: CheckResult = {
  kind: "available",
  currentVersion: "1.0.0",
  manifest: {
    version: "1.0.1",
    notes: "## Changelog\n- big fix\n- new feature",
    pubDate: "2026-05-15T10:00:00Z",
    platforms: {
      "darwin-aarch64": {
        signature: "sig",
        url: "https://updates.ide99.io/stable/x.dmg",
      },
    },
  },
  channel: "stable",
  checkedAt: "2026-05-07T00:00:00Z",
};

function resetUpdaterStore() {
  useUpdater.setState({
    currentVersion: "1.0.0",
    lastResult: null,
    checking: false,
    installing: false,
    progress: null,
    decision: null,
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  eventListeners.clear();
  resetUpdaterStore();
  useAppSettings.setState({
    settings: { ...baseSettings },
    loaded: true,
    loading: false,
  });

  invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "updater_current_version") return "1.0.0";
    if (cmd === "updater_check") return upToDateResult;
    if (cmd === "updater_install_pending") return undefined;
    if (cmd === "settings_set") return args?.settings as AppSettings;
    return undefined;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UpdateChecker", () => {
  it("renders the panel with current version", async () => {
    render(<UpdateChecker />);
    expect(screen.getByTestId("update-checker")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/updater.current_version.*1\.0\.0/)).toBeInTheDocument();
    });
  });

  it("Check button calls updater_check and renders the upToDate banner", async () => {
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(screen.getByTestId("updater-check"));
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === "updater_check")).toBe(true);
    });
    await screen.findByTestId("updater-result-upToDate");
  });

  it("renders release notes + Approve/Defer when an update is available", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "updater_current_version") return "1.0.0";
      if (cmd === "updater_check") return availableResult;
      return undefined;
    });
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(screen.getByTestId("updater-check"));
    await screen.findByTestId("updater-result-available");
    expect(screen.getByTestId("updater-release-notes")).toHaveTextContent("Changelog");
    expect(screen.getByTestId("updater-approve")).toBeInTheDocument();
    expect(screen.getByTestId("updater-defer")).toBeInTheDocument();
  });

  it("Approve triggers updater_install_pending and reflects progress events", async () => {
    // Hold install_pending open so `installing=true` persists long enough
    // for the listener subscription to land before we emit a progress
    // event. Without this, the mock resolves synchronously and the
    // useEffect cleanup tears down the listener before the emit lands.
    const resolveInstallRef: { current: (() => void) | null } = { current: null };
    const installPromise = new Promise<void>((resolve) => {
      resolveInstallRef.current = resolve;
    });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "updater_current_version") return "1.0.0";
      if (cmd === "updater_check") return availableResult;
      if (cmd === "updater_install_pending") return installPromise;
      return undefined;
    });
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(screen.getByTestId("updater-check"));
    await screen.findByTestId("updater-result-available");
    await user.click(screen.getByTestId("updater-approve"));

    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === "updater_install_pending")).toBe(true);
    });

    // Approve flips `decision` → 'approved'; the progress block now renders.
    await screen.findByTestId("updater-progress");

    // Wait for the listener subscription to register — `listen()` is
    // async, so we poll until at least one listener exists.
    await waitFor(() => {
      expect(eventListeners.get("updater:progress")?.size ?? 0).toBeGreaterThan(0);
    });

    await act(async () => {
      emit("updater:progress", {
        phase: "downloading",
        bytesDownloaded: 50,
        bytesTotal: 100,
      } satisfies UpdaterProgressEvent);
    });

    const bar = screen.getByTestId("updater-progress-bar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");

    // Let the install promise resolve cleanly so the test doesn't dangle.
    resolveInstallRef.current?.();
  });

  it("Defer hides the install buttons and shows the deferred banner", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "updater_current_version") return "1.0.0";
      if (cmd === "updater_check") return availableResult;
      return undefined;
    });
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(screen.getByTestId("updater-check"));
    await screen.findByTestId("updater-result-available");
    await user.click(screen.getByTestId("updater-defer"));
    expect(screen.getByTestId("updater-deferred")).toBeInTheDocument();
    expect(screen.queryByTestId("updater-approve")).not.toBeInTheDocument();
  });

  it("channel selector invokes settings_set with the new releaseChannel", async () => {
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.selectOptions(screen.getByTestId("updater-channel"), "beta");
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "settings_set",
        expect.objectContaining({
          settings: expect.objectContaining({ releaseChannel: "beta" }) as Partial<AppSettings>,
        }),
      );
    });
  });

  it("renders an error result inline (not as a thrown alert)", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "updater_current_version") return "1.0.0";
      if (cmd === "updater_check")
        return {
          kind: "error",
          message: "manifest unreachable",
          channel: "stable",
          checkedAt: "now",
        } satisfies CheckResult;
      return undefined;
    });
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(screen.getByTestId("updater-check"));
    await screen.findByTestId("updater-result-error");
    expect(screen.getByRole("alert")).toHaveTextContent("manifest unreachable");
  });

  it("ignores progress events that arrive before installing flips on", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "updater_current_version") return "1.0.0";
      if (cmd === "updater_check") return availableResult;
      return undefined;
    });
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(screen.getByTestId("updater-check"));
    await screen.findByTestId("updater-result-available");

    // No subscription yet → progress block isn't even mounted.
    expect(screen.queryByTestId("updater-progress")).not.toBeInTheDocument();
  });
});
