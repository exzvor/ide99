import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DropdownMenu } from "./DropdownMenu";

describe("DropdownMenu", () => {
  it("renders the trigger element", () => {
    render(      <DropdownMenu
        trigger={<button type="button">Open menu</button>}
        items={[{ label: "Edit", onSelect: () => {} }]}
      />,
);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("opens on click and shows items as menuitems", async () => {
    const user = userEvent.setup();
    render(      <DropdownMenu
        trigger={<button type="button">Open menu</button>}
        items={[
          { label: "Edit", onSelect: () => {} },
          { label: "Duplicate", onSelect: () => {} },
          { label: "Delete", onSelect: () => {}, destructive: true },
        ]}
      />,
);

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Edit");
    expect(items[2]).toHaveTextContent("Delete");
  });

  it("invokes onSelect when an item is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(      <DropdownMenu
        trigger={<button type="button">Open menu</button>}
        items={[{ label: "Edit", onSelect }]}
      />,
);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const editItem = await screen.findByRole("menuitem", { name: "Edit" });
    await user.click(editItem);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onSelect when an item is disabled", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(      <DropdownMenu
        trigger={<button type="button">Open menu</button>}
        items={[{ label: "Edit", onSelect, disabled: true }]}
      />,
);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const editItem = await screen.findByRole("menuitem", { name: "Edit" });
    await user.click(editItem);

    expect(onSelect).not.toHaveBeenCalled();
  });
});
