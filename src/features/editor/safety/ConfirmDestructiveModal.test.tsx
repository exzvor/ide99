import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ConfirmDestructiveModal } from "./ConfirmDestructiveModal";

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
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("ConfirmDestructiveModal", () => {
  const baseProps = {
    open: true,
    action: "DROP",
    target: "users",
    environment: "prod",
    onConfirm: () => {},
    onCancel: () => {},
  };

  it("Confirm button disabled until target typed", async () => {
    const user = userEvent.setup();
    render(<ConfirmDestructiveModal {...baseProps} />);
    const btn = screen.getByText(/confirmButton/i);
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText(/inputLabel/i), "users");
    expect(btn).not.toBeDisabled();
  });

  it("Confirm button stays disabled on partial / wrong text", async () => {
    const user = userEvent.setup();
    render(<ConfirmDestructiveModal {...baseProps} />);
    await user.type(screen.getByLabelText(/inputLabel/i), "user");
    expect(screen.getByText(/confirmButton/i)).toBeDisabled();
  });

  it("clicking Confirm fires onConfirm", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDestructiveModal {...baseProps} onConfirm={onConfirm} />);
    await user.type(screen.getByLabelText(/inputLabel/i), "users");
    await user.click(screen.getByText(/confirmButton/i));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("clicking Cancel fires onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDestructiveModal {...baseProps} onCancel={onCancel} />);
    await user.click(screen.getByText(/common\.cancel/i));
    expect(onCancel).toHaveBeenCalled();
  });

  it("Esc fires onCancel via Radix outsidePointerDown", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDestructiveModal {...baseProps} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("supports literal token like 'delete-all'", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(      <ConfirmDestructiveModal
        {...baseProps}
        target="delete-all"
        action="DELETE"
        onConfirm={onConfirm}
      />,
);
    await user.type(screen.getByLabelText(/inputLabel/i), "delete-all");
    await user.click(screen.getByText(/confirmButton/i));
    expect(onConfirm).toHaveBeenCalled();
  });
});
