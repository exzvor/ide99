import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "./Toast";

function ToastTrigger() {
  const toast = useToast();
  return (    <div>
      <button type="button" onClick={() => toast.success("Saved successfully")}>
        Trigger success
      </button>
      <button type="button" onClick={() => toast.error("Something failed")}>
        Trigger error
      </button>
    </div>
);
}

describe("Toast", () => {
  it("useToast() returns no-op api when no provider is mounted (does not throw)", () => {
    render(<ToastTrigger />);
    // Clicking should not throw, even without a provider.
    const button = screen.getByRole("button", { name: "Trigger success" });
    expect(() => button.click()).not.toThrow();
  });

  it("success() dispatches a toast that becomes visible inside ToastProvider", async () => {
    const user = userEvent.setup();
    render(      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
);

    await user.click(screen.getByRole("button", { name: "Trigger success" }));

    const toast = await screen.findByText("Saved successfully");
    expect(toast).toBeInTheDocument();
  });

  it("error() dispatches a toast with the error variant marker", async () => {
    const user = userEvent.setup();
    render(      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
);

    await user.click(screen.getByRole("button", { name: "Trigger error" }));

    const errorToast = await screen.findByTestId("toast-error");
    expect(errorToast).toHaveTextContent("Something failed");
  });
});
