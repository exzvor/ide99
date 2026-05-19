import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

function Harness({
  initialOpen = true,
  ...overrides
}: { initialOpen?: boolean } & Partial<React.ComponentProps<typeof Dialog>>) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Add new connection"
      description="Enter a host and port to connect."
      footer={
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      }
      {...overrides}
    >
      <p>body content</p>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("renders with role=dialog, accessible title and description when open", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Add new connection")).toBeInTheDocument();
    expect(screen.getByText("Enter a host and port to connect.")).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
  });

  it("does not render dialog content when closed", () => {
    render(<Harness initialOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("invokes onOpenChange(false) when Esc is pressed by default", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="t">
        <p>x</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not close on Escape when closeOnEscape is false", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="t" closeOnEscape={false}>
        <p>x</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("renders an icon-only close button when closeAriaLabel is provided", () => {
    render(<Harness closeAriaLabel="Close dialog" />);
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });
});
