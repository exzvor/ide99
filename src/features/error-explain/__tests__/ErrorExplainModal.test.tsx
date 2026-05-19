/**
 * — host modal smoke tests.
 *
 * Drives the modal via the imperative `openErrorExplain(payload)` helper to
 * mimic real call-sites (ResultPanel, ExplainErrorView, ApplyDialog).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../components/Toast";
import i18n from "../../../i18n";
import { ErrorExplainModalHost, openErrorExplain } from "../ErrorExplainModal";

function renderHost() {
  return render(    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <ErrorExplainModalHost />
      </ToastProvider>
    </I18nextProvider>,
);
}

describe("ErrorExplainModalHost", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing until opened", () => {
    renderHost();
    expect(screen.queryByText("Error explanation")).not.toBeInTheDocument();
  });

  it("opens with explanation for known SQLSTATE", () => {
    renderHost();
    act(() => openErrorExplain({ sqlstate: "23505", message: "duplicate key" }));
    expect(screen.getByText(/Error explanation|Объяснение/i)).toBeInTheDocument();
    expect(screen.getByText(/SQLSTATE 23505/)).toBeInTheDocument();
  });

  it("falls back to AskAgentBlock for unknown SQLSTATE", () => {
    renderHost();
    act(() => openErrorExplain({ sqlstate: "ZZ999", message: "totally unknown" }));
    expect(screen.getByTestId("error-explain-copy-context")).toBeInTheDocument();
  });

  it("copies error context to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderHost();
    act(() =>
      openErrorExplain({
        sqlstate: "ZZ999",
        message: "boom",
        sql: "DROP TABLE x;",
      }),
);
    fireEvent.click(screen.getByTestId("error-explain-copy-context"));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const arg = writeText.mock.calls[0]?.[0];
    expect(arg).toContain("SQLSTATE: ZZ999");
    expect(arg).toContain("Message: boom");
    expect(arg).toContain("DROP TABLE x;");
  });

  it("closes via Close button", async () => {
    const user = userEvent.setup();
    renderHost();
    act(() => openErrorExplain({ sqlstate: "23505", message: "x" }));
    await user.click(screen.getByTestId("error-explain-close"));
    expect(screen.queryByText(/SQLSTATE 23505/)).not.toBeInTheDocument();
  });
});
