import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EnvironmentSelect } from "./EnvironmentSelect";

beforeAll(() => {
  // Radix Select internals — jsdom polyfills.
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("EnvironmentSelect", () => {
  it("renders trigger with current value badge", () => {
    const { container } = render(<EnvironmentSelect value="prod" onChange={() => {}} />);
    expect(container.querySelector(".env-badge.prod")).toBeInTheDocument();
  });

  it("calls onChange when item selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EnvironmentSelect value="local" onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    // Radix Select renders items as buttons after trigger click.
    const opt = await screen.findByText(/env\.label\.dev/i);
    await user.click(opt);
    expect(onChange).toHaveBeenCalledWith("dev");
  });
});
