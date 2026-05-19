import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { FkPickerModal } from "./FkPickerModal";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function H(props: Partial<React.ComponentProps<typeof FkPickerModal>> = {}) {
  const defaults = {
    open: true,
    sourceTable: {
      id: "public.orders",
      name: "orders",
      columns: [
        { id: "user_id", name: "user_id", dataType: "bigint" },
        { id: "tenant_id", name: "tenant_id", dataType: "bigint" },
      ],
    },
    targetTable: {
      id: "public.users",
      name: "users",
      columns: [
        { id: "id", name: "id", dataType: "bigint", isPkOrUnique: true },
        { id: "email", name: "email", dataType: "text", isPkOrUnique: false },
      ],
    },
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <FkPickerModal {...defaults} {...props} />
    </I18nextProvider>,
  );
}

describe("FkPickerModal", () => {
  it("Cancel triggers onCancel", () => {
    const onCancel = vi.fn();
    H({ onCancel });
    fireEvent.click(screen.getByTestId("fk-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
  it("Add disabled until at least one source + target column selected", () => {
    H();
    expect(screen.getByTestId("fk-confirm")).toBeDisabled();
  });
  it("Confirm passes selection and constraint name", () => {
    const onConfirm = vi.fn();
    H({ onConfirm });
    fireEvent.click(screen.getByTestId("fk-source-user_id"));
    fireEvent.click(screen.getByTestId("fk-target-id"));
    fireEvent.change(screen.getByTestId("fk-name"), { target: { value: "orders_user_id_fkey" } });
    fireEvent.click(screen.getByTestId("fk-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(["user_id"], ["id"], "orders_user_id_fkey");
  });
});
