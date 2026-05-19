import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { EditToolbar } from "./EditToolbar";
import { useEditStore } from "./store";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => useEditStore.getState().reset());

function harness(props: Partial<React.ComponentProps<typeof EditToolbar>> = {}) {
  const defaults = {
    tabId: "tab-1",
    onApply: vi.fn(),
    onDiscard: vi.fn(),
    onResetLayout: vi.fn(),
    onAddTable: vi.fn(),
    canResetLayout: true,
    canApply: true,
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <EditToolbar {...defaults} {...props} />
    </I18nextProvider>,
  );
}

describe("EditToolbar", () => {
  it("read-mode shows only the Edit toggle", () => {
    harness();
    expect(screen.getByTestId("edit-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-apply")).toBeNull();
    expect(screen.queryByTestId("edit-new-table")).toBeNull();
  });

  it("clicking toggle flips to edit mode and reveals action buttons", () => {
    harness();
    fireEvent.click(screen.getByTestId("edit-toggle"));
    expect(useEditStore.getState().getMode("tab-1")).toBe("edit");
    expect(screen.getByTestId("edit-new-table")).toBeInTheDocument();
    expect(screen.getByTestId("edit-apply")).toBeInTheDocument();
  });

  it("Apply disabled when no ops or canApply=false", () => {
    useEditStore.getState().setMode("tab-1", "edit");
    harness({ canApply: false });
    expect(screen.getByTestId("edit-apply")).toBeDisabled();
  });

  it("Undo / Redo enabled state reflects store", () => {
    useEditStore.getState().setMode("tab-1", "edit");
    useEditStore
      .getState()
      .pushOp("tab-1", { kind: "addTable", id: "x", schema: "p", name: "n", seedColumns: [] });
    harness();
    expect(screen.getByTestId("edit-undo")).not.toBeDisabled();
    expect(screen.getByTestId("edit-redo")).toBeDisabled();
    fireEvent.click(screen.getByTestId("edit-undo"));
    expect(screen.getByTestId("edit-redo")).not.toBeDisabled();
  });

  it("Reset Layout hidden when canResetLayout=false", () => {
    useEditStore.getState().setMode("tab-1", "edit");
    harness({ canResetLayout: false });
    expect(screen.queryByTestId("edit-reset-layout")).toBeNull();
  });
});
