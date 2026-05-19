import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { ApplyConfirmModal } from "./ApplyConfirmModal";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function H(props: Partial<React.ComponentProps<typeof ApplyConfirmModal>> = {}) {
  const defaults = {
    open: true,
    statementCount: 3,
    connectionName: "prod-db",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <ApplyConfirmModal {...defaults} {...props} />
    </I18nextProvider>,
  );
}

describe("ApplyConfirmModal", () => {
  it("hides when open=false", () => {
    H({ open: false });
    expect(screen.queryByTestId("apply-confirm-modal")).toBeNull();
  });
  it("shows count and connection in body", () => {
    H();
    expect(screen.getByTestId("apply-confirm-modal")).toHaveTextContent("3");
    expect(screen.getByTestId("apply-confirm-modal")).toHaveTextContent("prod-db");
  });
  it("Cancel triggers onCancel", () => {
    const onCancel = vi.fn();
    H({ onCancel });
    fireEvent.click(screen.getByTestId("apply-confirm-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
  it("Apply triggers onConfirm", () => {
    const onConfirm = vi.fn();
    H({ onConfirm });
    fireEvent.click(screen.getByTestId("apply-confirm-ok"));
    expect(onConfirm).toHaveBeenCalled();
  });
});
