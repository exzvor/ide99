import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SlowQueryWarningModal } from "./SlowQueryWarningModal";

beforeAll(() => {
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
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}::${JSON.stringify(opts)}` : key,
  }),
}));

describe("SlowQueryWarningModal", () => {
  const baseProps = {
    open: true,
    cost: 250_000,
    onCancel: () => {},
    onProceed: () => {},
  };

  it("renders rounded cost", () => {
    render(<SlowQueryWarningModal {...baseProps} />);
    expect(screen.getByText(/250000/)).toBeInTheDocument();
  });

  it("Run anyway with dontAsk=false propagates", async () => {
    const onProceed = vi.fn();
    const user = userEvent.setup();
    render(<SlowQueryWarningModal {...baseProps} onProceed={onProceed} />);
    await user.click(screen.getByText(/runAnyway/i));
    expect(onProceed).toHaveBeenCalledWith(false);
  });

  it("Run anyway with dontAsk=true propagates true", async () => {
    const onProceed = vi.fn();
    const user = userEvent.setup();
    render(<SlowQueryWarningModal {...baseProps} onProceed={onProceed} />);
    await user.click(screen.getByLabelText(/dontAsk/i));
    await user.click(screen.getByText(/runAnyway/i));
    expect(onProceed).toHaveBeenCalledWith(true);
  });

  it("Cancel fires onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<SlowQueryWarningModal {...baseProps} onCancel={onCancel} />);
    await user.click(screen.getByText(/common\.cancel/i));
    expect(onCancel).toHaveBeenCalled();
  });
});
