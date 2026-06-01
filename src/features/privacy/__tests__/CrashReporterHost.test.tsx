/**
 * CrashReporterHost — send-result feedback (issue #14).
 *
 * The crash dialog used to close on "Send report" with no visible outcome,
 * and the backend returned a silent Ok when no DSN was configured — so a
 * report that went nowhere looked identical to a delivered one. These tests
 * pin the user-visible feedback: success toast on send, a distinct
 * "not configured" info toast, and an error toast on a genuine failure.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CrashReporterHost } from "../CrashReporterHost";

beforeAll(() => {
  // Radix Dialog internals — jsdom polyfills.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const toast = {
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  errorWithAction: vi.fn(),
};
vi.mock("../../../components/Toast", () => ({ useToast: () => toast }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const buildCrashReportMock = vi.fn();
const sendCrashReportMock = vi.fn();

interface HostState {
  settings: { privacyChoiceMade: boolean; crashReportsEnabled: boolean } | null;
  buildCrashReport: typeof buildCrashReportMock;
  sendCrashReport: typeof sendCrashReportMock;
}

let storeState: HostState;
vi.mock("../store", () => ({
  useAppSettings: <U,>(selector: (s: HostState) => U): U => selector(storeState),
}));

const sampleReport = {
  message: "boom",
  stack: "",
  platform: "darwin aarch64",
  appVersion: "1.0.0",
  capturedAt: "2026-06-01T00:00:00Z",
};

beforeEach(() => {
  toast.success.mockReset();
  toast.info.mockReset();
  toast.error.mockReset();
  buildCrashReportMock.mockReset().mockResolvedValue(sampleReport);
  sendCrashReportMock.mockReset();
  storeState = {
    settings: { privacyChoiceMade: true, crashReportsEnabled: true },
    buildCrashReport: buildCrashReportMock,
    sendCrashReport: sendCrashReportMock,
  };
});

async function openDialogAndApprove() {
  render(<CrashReporterHost />);
  window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: new Error("boom") }));
  const approve = await screen.findByTestId("crash-approve");
  await userEvent.click(approve);
}

describe("CrashReporterHost", () => {
  it("shows a success toast when the crash report is sent", async () => {
    sendCrashReportMock.mockResolvedValueOnce(undefined);
    await openDialogAndApprove();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("privacy.crash.send.success"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows an info toast (not a fake success) when reporting is not configured", async () => {
    sendCrashReportMock.mockRejectedValueOnce({ code: "not_configured", message: "x" });
    await openDialogAndApprove();
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("privacy.crash.send.not_configured"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows an error toast when the send genuinely fails", async () => {
    sendCrashReportMock.mockRejectedValueOnce({ code: "network_error", message: "boom" });
    await openDialogAndApprove();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("privacy.crash.send.error"));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
