import "../../../i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableView, isTabularValue } from "./TableView";

describe("isTabularValue", () => {
  it("true for uniform array of objects with ≤12 keys", () => {
    expect(
      isTabularValue([
        { a: 1, b: 2 },
        { a: 2, b: 3 },
      ]),
    ).toBe(true);
  });

  it("false for >12 unique keys", () => {
    const a: Record<string, number> = {};
    for (let i = 0; i < 13; i++) a[`k${i}`] = i;
    expect(isTabularValue([a])).toBe(false);
  });

  it("false for empty array", () => {
    expect(isTabularValue([])).toBe(false);
  });

  it("false when any element is not a plain object", () => {
    expect(isTabularValue([{ a: 1 }, 42])).toBe(false);
  });

  it("false when value is not an array", () => {
    expect(isTabularValue({ a: 1 })).toBe(false);
    expect(isTabularValue(null)).toBe(false);
    expect(isTabularValue("hi")).toBe(false);
  });

  it("false when an element is a nested array (not a plain object)", () => {
    expect(isTabularValue([{ a: 1 }, [1, 2]])).toBe(false);
  });
});

describe("TableView render", () => {
  it("renders headers from union of keys (sorted alphabetically)", () => {
    render(<TableView value={[{ b: 1, a: 1 }, { c: 1 }]} onChange={() => {}} readOnly={false} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    // Filter out the trailing empty action-column header.
    const dataHeaders = headers.filter((h) => h.length > 0);
    expect(dataHeaders).toEqual(["a", "b", "c"]);
  });

  it("returns null when value is not tabular", () => {
    const { container } = render(<TableView value={42} onChange={() => {}} readOnly={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("returns null for empty array", () => {
    const { container } = render(<TableView value={[]} onChange={() => {}} readOnly={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onChange when a cell is edited", () => {
    const onChange = vi.fn();
    render(<TableView value={[{ a: 1 }, { a: 2 }]} onChange={onChange} readOnly={false} />);
    const cell = screen.getByTestId("jsonb-table-cell-0-a");
    fireEvent.click(cell);
    const input = screen.getByTestId("jsonb-table-cell-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith([{ a: 99 }, { a: 2 }]);
  });

  it("preserves missing keys as undefined / sparse cells", () => {
    render(<TableView value={[{ a: 1 }, { b: 2 }]} onChange={() => {}} readOnly={false} />);
    expect(screen.getByTestId("jsonb-table-cell-0-b").textContent).toBe("");
    expect(screen.getByTestId("jsonb-table-cell-1-a").textContent).toBe("");
  });

  it("renders [+ row] action that pushes an empty object", () => {
    const onChange = vi.fn();
    render(<TableView value={[{ a: 1 }]} onChange={onChange} readOnly={false} />);
    fireEvent.click(screen.getByTestId("jsonb-table-add-row"));
    expect(onChange).toHaveBeenCalledWith([{ a: 1 }, {}]);
  });

  it("renders [× row] action per row that deletes that row", () => {
    const onChange = vi.fn();
    render(<TableView value={[{ a: 1 }, { a: 2 }]} onChange={onChange} readOnly={false} />);
    fireEvent.click(screen.getByTestId("jsonb-table-delete-row-0"));
    expect(onChange).toHaveBeenCalledWith([{ a: 2 }]);
  });

  it("hides row-level edit affordances when readOnly", () => {
    render(<TableView value={[{ a: 1 }]} onChange={() => {}} readOnly />);
    expect(screen.queryByTestId("jsonb-table-add-row")).toBeNull();
    expect(screen.queryByTestId("jsonb-table-delete-row-0")).toBeNull();
  });

  it("renders boolean / null cells with type-aware editor on click", () => {
    const onChange = vi.fn();
    render(<TableView value={[{ flag: true }]} onChange={onChange} readOnly={false} />);
    fireEvent.click(screen.getByTestId("jsonb-table-cell-0-flag"));
    const select = screen.getByTestId("jsonb-table-cell-input") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "false" } });
    fireEvent.blur(select);
    expect(onChange).toHaveBeenCalledWith([{ flag: false }]);
  });
});
