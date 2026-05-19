import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

// Radix Select internally calls hasPointerCapture / setPointerCapture /
// releasePointerCapture / scrollIntoView, none of which jsdom implements.
// Polyfill them so the popover can open in tests.
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
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const OPTIONS = [
  { value: "disable", label: "disable" },
  { value: "prefer", label: "prefer" },
  { value: "require", label: "require" },
];

function Harness({
  initial = "prefer",
  onChange,
}: {
  initial?: string;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (    <Select
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={OPTIONS}
      ariaLabel="SSL mode"
    />
);
}

describe("Select", () => {
  it("renders a combobox trigger with the supplied aria-label", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "SSL mode" });
    expect(trigger).toBeInTheDocument();
  });

  it("displays the current value text on the trigger", () => {
    render(<Harness initial="require" />);
    expect(screen.getByRole("combobox", { name: "SSL mode" })).toHaveTextContent("require");
  });

  it("opens and exposes options with role=option, allowing selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "SSL mode" }));

    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(3);

    const requireOption = options.find((el) => el.textContent === "require");
    expect(requireOption).toBeDefined();
    if (requireOption) await user.click(requireOption);

    expect(onChange).toHaveBeenCalledWith("require");
  });
});
