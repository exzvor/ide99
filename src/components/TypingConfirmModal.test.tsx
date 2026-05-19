import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TypingConfirmModal } from "./TypingConfirmModal";

beforeAll(() => {
  // Radix Dialog jsdom shims (mirrors BatchConfirmModal.test.tsx).
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

const baseProps = (overrides?: Partial<Parameters<typeof TypingConfirmModal>[0]>) => ({
  title: "Confirm write",
  description: "You are about to UPDATE public.events. Type the table name:",
  expectedToken: "public.events",
  inputLabel: "Type public.events",
  confirmLabel: "Apply",
  cancelLabel: "Cancel",
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  ...overrides,
});

afterEach(() => vi.clearAllMocks());

describe("TypingConfirmModal", () => {
  it("renders title + description in the dialog", () => {
    render(<TypingConfirmModal {...baseProps()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm write")).toBeInTheDocument();
    expect(screen.getByText(/UPDATE public\.events/)).toBeInTheDocument();
  });

  it("disables Apply until input matches expectedToken (case-insensitive)", () => {
    render(<TypingConfirmModal {...baseProps()} />);
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
    const input = screen.getByLabelText("Type public.events");
    fireEvent.change(input, { target: { value: "PUBLIC.EVENTS" } });
    expect(apply).not.toBeDisabled();
  });

  it("calls onConfirm with the typed token on Apply", () => {
    const onConfirm = vi.fn();
    render(<TypingConfirmModal {...baseProps({ onConfirm })} />);
    const input = screen.getByLabelText("Type public.events");
    fireEvent.change(input, { target: { value: "public.events" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith("public.events");
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<TypingConfirmModal {...baseProps({ onCancel })} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders dangerSqlPreview when provided", () => {
    render(      <TypingConfirmModal
        {...baseProps({ dangerSqlPreview: "UPDATE public.events SET data = $1 WHERE id = 1" })}
      />,
);
    expect(screen.getByText(/UPDATE public.events SET data/)).toBeInTheDocument();
  });

  it("supports a custom requireTyping=false to skip the gate (auto-enabled)", () => {
    render(<TypingConfirmModal {...baseProps({ requireTyping: false })} />);
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).not.toBeDisabled();
  });
});
