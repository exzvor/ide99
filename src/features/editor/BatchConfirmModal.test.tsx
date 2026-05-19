/**
 * Post-S14 — BatchConfirmModal tests. The modal is summoned by
 * `preflightBatch` for N>1 destructive runs and renders a single
 * consolidated prompt in lieu of one ConfirmDestructiveModal per
 * destructive statement.
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// Side-effect: ensure i18next is initialised so `useTranslation` returns
// real strings instead of bare keys.
import "../../i18n";
import { BatchConfirmModal } from "./BatchConfirmModal";

beforeAll(() => {
  // Radix Dialog internals — jsdom polyfills (mirrors
  // ConfirmDestructiveModal.test.tsx).
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

const props = (overrides?: Partial<Parameters<typeof BatchConfirmModal>[0]>) => ({
  open: true,
  total: 5,
  environment: "prod" as const,
  databaseName: "ide99_diag",
  destructive: [
    { index: 1, action: "DROP", target: "users_old", snippet: "DROP TABLE users_old" },
    { index: 3, action: "TRUNCATE", target: "audit_log", snippet: "TRUNCATE TABLE audit_log" },
  ],
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  ...overrides,
});

afterEach(() => vi.clearAllMocks());

describe("BatchConfirmModal", () => {
  it("renders title + lead with total + destructive count", () => {
    render(<BatchConfirmModal {...props()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Lead text mentions the total batch size + the destructive count.
    // We don't pin to exact wording (translations may shift) — check both
    // numbers appear somewhere in the dialog.
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent ?? "").toMatch(/5/);
    expect(dialog.textContent ?? "").toMatch(/2/);
  });

  it("lists each destructive statement with its index + snippet", () => {
    render(<BatchConfirmModal {...props()} />);
    expect(screen.getByText(/DROP TABLE users_old/)).toBeInTheDocument();
    expect(screen.getByText(/TRUNCATE TABLE audit_log/)).toBeInTheDocument();
  });

  it("on prod requires typing the db name to enable Confirm", () => {
    const onConfirm = vi.fn();
    render(<BatchConfirmModal {...props({ onConfirm })} />);
    const confirmBtn = screen.getByRole("button", { name: /выполнить|run/i });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText(/database name|имя бд/i);
    fireEvent.change(input, { target: { value: "ide99_diag" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("on dev/stage skips the type-db-name gate", () => {
    render(<BatchConfirmModal {...props({ environment: "dev" })} />);
    const confirmBtn = screen.getByRole("button", { name: /выполнить|run/i });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("Cancel calls onCancel", () => {
    const onCancel = vi.fn();
    render(<BatchConfirmModal {...props({ onCancel })} />);
    const cancelBtn = screen.getByRole("button", { name: /отмена|cancel/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
