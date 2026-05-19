import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, test, vi } from "vitest";
import i18n from "../../i18n";
import { EmptyState } from "./EmptyState";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("<EmptyState>", () => {
  test("idle: renders Database icon + localized title and body", () => {
    renderWithI18n(<EmptyState kind="idle" />);

    expect(screen.getByTestId("schema-empty-idle")).toBeInTheDocument();
    expect(screen.getByTestId("schema-empty-idle-icon")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("schema.empty.title"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("schema.empty.body"))).toBeInTheDocument();
  });

  test("error: renders red AlertTriangle icon + message + Retry button", async () => {
    const onRetry = vi.fn();
    renderWithI18n(<EmptyState kind="error" message="connection refused" onRetry={onRetry} />);

    expect(screen.getByTestId("schema-empty-error")).toBeInTheDocument();
    expect(screen.getByTestId("schema-empty-error-icon")).toBeInTheDocument();
    expect(screen.getByText("connection refused")).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: i18n.t("schema.retry") });
    expect(retry).toBeInTheDocument();

    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("error without onRetry: omits the Retry button", () => {
    renderWithI18n(<EmptyState kind="error" message="boom" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
