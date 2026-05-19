/**
 * — CrashReportDialog tests (acceptance criterion #2).
 *
 * - preview shows the captured stack + system info
 * - approve invokes the supplied onApprove handler
 * - cancel invokes onCancel and does NOT call onApprove
 * - returns null when report is null
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CrashReportDialog } from "../CrashReportDialog";
import type { CrashReport } from "../types";

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

const sample: CrashReport = {
  message: "TypeError: cannot read 'foo' of undefined",
  stack: "at fn (file.js:10:5)\nat handler (app.js:42:3)",
  platform: "darwin-aarch64",
  appVersion: "0.1.0",
  capturedAt: "2026-05-07T12:34:56Z",
};

describe("CrashReportDialog", () => {
  it("returns null when report is null", () => {
    const { container } = render(
      <CrashReportDialog open report={null} onApprove={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='crash-report-dialog']")).toBeNull();
  });

  it("preview shows the stack and system info", () => {
    render(<CrashReportDialog open report={sample} onApprove={vi.fn()} onCancel={vi.fn()} />);
    const stack = screen.getByTestId("crash-stack");
    expect(stack).toHaveTextContent("at fn (file.js:10:5)");
    expect(stack).toHaveTextContent("at handler (app.js:42:3)");
    expect(screen.getByText("darwin-aarch64")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText(sample.message)).toBeInTheDocument();
  });

  it("approve calls onApprove and not onCancel", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    render(<CrashReportDialog open report={sample} onApprove={onApprove} onCancel={onCancel} />);
    await user.click(screen.getByTestId("crash-approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancel calls onCancel and does NOT call onApprove", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    render(<CrashReportDialog open report={sample} onApprove={onApprove} onCancel={onCancel} />);
    await user.click(screen.getByTestId("crash-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });
});
