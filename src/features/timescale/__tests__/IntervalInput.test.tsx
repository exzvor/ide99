// — .
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IntervalInput, intervalToSqlLiteral } from "../IntervalInput";

describe("intervalToSqlLiteral", () => {
  it("formats day intervals with pluralized unit", () => {
    expect(intervalToSqlLiteral({ count: 7, unit: "day" })).toBe("7 days");
  });

  it("always pluralizes — Postgres accepts 1 months too", () => {
    expect(intervalToSqlLiteral({ count: 1, unit: "month" })).toBe("1 months");
  });

  it("handles all units consistently", () => {
    expect(intervalToSqlLiteral({ count: 5, unit: "minute" })).toBe("5 minutes");
    expect(intervalToSqlLiteral({ count: 2, unit: "hour" })).toBe("2 hours");
    expect(intervalToSqlLiteral({ count: 3, unit: "week" })).toBe("3 weeks");
  });
});

describe("IntervalInput", () => {
  it("renders the count and unit from props", () => {
    render(      <IntervalInput idSuffix="chunk" value={{ count: 7, unit: "day" }} onChange={() => {}} />,
);
    const root = screen.getByTestId("interval-input-chunk");
    const numberInput = root.querySelector("input[type='number']") as HTMLInputElement;
    const select = root.querySelector("select") as HTMLSelectElement;
    expect(numberInput.value).toBe("7");
    expect(select.value).toBe("day");
  });

  it("calls onChange when the count changes", () => {
    const onChange = vi.fn();
    render(      <IntervalInput idSuffix="chunk" value={{ count: 7, unit: "day" }} onChange={onChange} />,
);
    const root = screen.getByTestId("interval-input-chunk");
    const numberInput = root.querySelector("input[type='number']") as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "14" } });
    expect(onChange).toHaveBeenCalledWith({ count: 14, unit: "day" });
  });

  it("calls onChange when the unit changes", () => {
    const onChange = vi.fn();
    render(      <IntervalInput idSuffix="chunk" value={{ count: 7, unit: "day" }} onChange={onChange} />,
);
    const root = screen.getByTestId("interval-input-chunk");
    const select = root.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "month" } });
    expect(onChange).toHaveBeenCalledWith({ count: 7, unit: "month" });
  });
});
