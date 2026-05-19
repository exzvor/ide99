import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock react-i18next so that `t(key, { defaultValue })` returns the
// defaultValue, mirroring real runtime behaviour when the key is missing.
// This matches the project's other editor-feature tests (RunToolbar) which
// also mock `react-i18next` rather than wrapping in `<I18nextProvider>`.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object" && "defaultValue" in opts) {
        return String((opts as { defaultValue: unknown }).defaultValue);
      }
      return key;
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

import { FilterDropdown, operatorsFor } from "./FilterDropdown";

describe("operatorsFor", () => {
  it("text type only allows eq/ne/like/null", () => {
    expect(operatorsFor("text")).toEqual(["eq", "ne", "like", "isNull", "isNotNull"]);
  });

  it("integer type allows comparison ops", () => {
    expect(operatorsFor("integer")).toContain("lt");
    expect(operatorsFor("integer")).not.toContain("like");
  });

  it("returns a safe minimal op set when dataType is undefined", () => {
    expect(operatorsFor(undefined)).toEqual(["eq", "ne", "isNull", "isNotNull"]);
  });
});

describe("<FilterDropdown />", () => {
  it("calls onApply with parsed numeric filter on Apply click", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <FilterDropdown
        current={null}
        columnName="id"
        dataType="integer"
        onApply={onApply}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "gt" },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByText("Apply"));
    expect(onApply).toHaveBeenCalledWith({
      column: "id",
      op: "gt",
      value: 10,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("hides value input for IS NULL", () => {
    render(
      <FilterDropdown
        current={null}
        columnName="x"
        dataType="text"
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "isNull" },
    });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Clear emits null and closes", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <FilterDropdown
        current={{ column: "id", op: "eq", value: 5 }}
        columnName="id"
        dataType="integer"
        onApply={onApply}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText("Clear"));
    expect(onApply).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });
});
