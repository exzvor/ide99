/**
 * — VibepgResultDialog.
 *
 * 1. Stub variant: "Connecting…" + v1.1 note + Cancel button only.
 * 2. With preview: renders all field rows + iteration log + Apply.
 * 3. Apply (recommendation=create) writes tested SQL to clipboard and closes.
 * 4. Apply (recommendation=skip) closes without clipboard write.
 * 5. onApply override is honored when supplied (no clipboard fallback).
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { VibepgResultDialog, type VibepgResultPreview } from "./VibepgResultDialog";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PREVIEW: VibepgResultPreview = {
  tested: "CREATE INDEX idx_orders_user_id ON orders(user_id);",
  planBefore: "Seq Scan, 2300ms",
  planAfter: "Index Scan, 12ms",
  speedup: "191x",
  indexSize: "240 MB",
  recommendation: "create",
};

function installClipboardMock(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VibepgResultDialog (S37)", () => {
  it("renders the v1.0 stub when no preview is supplied", () => {
    render(<VibepgResultDialog open={true} onOpenChange={() => {}} />);
    expect(screen.getByTestId("vibepg-result-stub")).toBeInTheDocument();
    expect(screen.getByTestId("vibepg-result-cancel")).toBeInTheDocument();
    // Apply button must NOT exist in stub mode.
    expect(screen.queryByTestId("vibepg-result-apply")).not.toBeInTheDocument();
  });

  it("renders all preview fields + iteration log when preview is supplied", () => {
    render(<VibepgResultDialog open={true} onOpenChange={() => {}} preview={PREVIEW} />);
    expect(screen.getByTestId("vibepg-field-tested")).toHaveTextContent(/CREATE INDEX/);
    expect(screen.getByTestId("vibepg-field-plan-before")).toHaveTextContent(/2300ms/);
    expect(screen.getByTestId("vibepg-field-plan-after")).toHaveTextContent(/12ms/);
    expect(screen.getByTestId("vibepg-field-speedup")).toHaveTextContent("191x");
    expect(screen.getByTestId("vibepg-field-index-size")).toHaveTextContent("240 MB");
    expect(screen.getByTestId("vibepg-field-recommendation")).toHaveTextContent(/create/i);

    // Iteration log enumerates all six steps.
    expect(screen.getByTestId("vibepg-step-step_generate")).toBeInTheDocument();
    expect(screen.getByTestId("vibepg-step-step_apply")).toBeInTheDocument();
    expect(screen.getByTestId("vibepg-step-step_error")).toBeInTheDocument();
    expect(screen.getByTestId("vibepg-step-step_refine")).toBeInTheDocument();
    expect(screen.getByTestId("vibepg-step-step_retry")).toBeInTheDocument();
    expect(screen.getByTestId("vibepg-step-step_success")).toBeInTheDocument();
  });

  it("Apply (recommendation=create) writes tested SQL to clipboard and closes", async () => {
    const writeText = installClipboardMock();
    const onOpenChange = vi.fn();

    render(<VibepgResultDialog open={true} onOpenChange={onOpenChange} preview={PREVIEW} />);
    // Native click() bypasses userEvent's pointer-event preflight, which is
    // overly conservative inside Radix's focus-trapped dialog body.
    (screen.getByTestId("vibepg-result-apply") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(PREVIEW.tested);
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("Apply (recommendation=skip) closes without clipboard write", async () => {
    const writeText = installClipboardMock();
    const onOpenChange = vi.fn();
    const skipPreview: VibepgResultPreview = { ...PREVIEW, recommendation: "skip" };

    render(<VibepgResultDialog open={true} onOpenChange={onOpenChange} preview={skipPreview} />);
    (screen.getByTestId("vibepg-result-apply") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("onApply override is invoked instead of the clipboard fallback", async () => {
    const writeText = installClipboardMock();
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <VibepgResultDialog
        open={true}
        onOpenChange={onOpenChange}
        preview={PREVIEW}
        onApply={onApply}
      />,
    );
    (screen.getByTestId("vibepg-result-apply") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith(PREVIEW);
    });
    // override path must NOT also write to clipboard
    expect(writeText).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
