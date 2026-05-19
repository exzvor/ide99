import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EasyToggle } from "../EasyToggle";
import { useUiMode } from "../store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("EasyToggle", () => {
  beforeEach(() => {
    useUiMode.setState({ mode: "standard", tourCompleted: false });
  });
  afterEach(() => {
    useUiMode.setState({ mode: "standard", tourCompleted: false });
  });

  it("toggles mode standard → easy on click", async () => {
    const user = userEvent.setup();
    render(<EasyToggle />);
    await user.click(screen.getByTestId("easy-mode-toggle"));
    expect(useUiMode.getState().mode).toBe("easy");
  });

  it("dispatches ide99:tour:start on first switch into easy", async () => {
    const listener = vi.fn();
    window.addEventListener("ide99:tour:start", listener);
    const user = userEvent.setup();
    render(<EasyToggle />);
    await user.click(screen.getByTestId("easy-mode-toggle"));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("ide99:tour:start", listener);
  });

  it("does NOT dispatch tour event when tourCompleted is already true", async () => {
    useUiMode.setState({ mode: "standard", tourCompleted: true });
    const listener = vi.fn();
    window.addEventListener("ide99:tour:start", listener);
    const user = userEvent.setup();
    render(<EasyToggle />);
    await user.click(screen.getByTestId("easy-mode-toggle"));
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("ide99:tour:start", listener);
  });

  it("does NOT dispatch tour event when switching easy → standard", async () => {
    useUiMode.setState({ mode: "easy", tourCompleted: false });
    const listener = vi.fn();
    window.addEventListener("ide99:tour:start", listener);
    const user = userEvent.setup();
    render(<EasyToggle />);
    await user.click(screen.getByTestId("easy-mode-toggle"));
    expect(useUiMode.getState().mode).toBe("standard");
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("ide99:tour:start", listener);
  });

  it("aria-pressed reflects current mode", () => {
    render(<EasyToggle />);
    expect(screen.getByTestId("easy-mode-toggle")).toHaveAttribute("aria-pressed", "false");
  });
});
