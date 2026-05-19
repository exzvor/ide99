// — FunctionPicker tests (B3.T3 — picker portion).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaListFunctions: vi.fn(),
  };
});

import { schemaListFunctions } from "../../../lib/tauri";
import { FunctionPicker } from "./FunctionPicker";

const mockedList = schemaListFunctions as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedList.mockReset();
});

describe("FunctionPicker", () => {
  it("renders the trigger-fn list returned by schemaListFunctions", async () => {
    mockedList.mockResolvedValue([
      { name: "audit_fn", args: "", returnKind: "trigger", returnType: null },
      { name: "log_fn", args: "", returnKind: "trigger", returnType: null },
    ]);
    render(      <FunctionPicker
        value={{ schema: "public", name: "" }}
        onChange={() => {}}
        connId="c1"
        schema="public"
      />,
);
    await waitFor(() => {
      expect(screen.getByTestId("trigger-fn-option-audit_fn")).toBeInTheDocument();
      expect(screen.getByTestId("trigger-fn-option-log_fn")).toBeInTheDocument();
    });
    expect(mockedList).toHaveBeenCalledWith("c1", "public", true);
  });

  it("clicking a function calls onChange with that function", async () => {
    mockedList.mockResolvedValue([
      { name: "audit_fn", args: "", returnKind: "trigger", returnType: null },
    ]);
    const onChange = vi.fn();
    render(      <FunctionPicker
        value={{ schema: "public", name: "" }}
        onChange={onChange}
        connId="c1"
        schema="public"
      />,
);
    await waitFor(() =>
      expect(screen.getByTestId("trigger-fn-option-audit_fn")).toBeInTheDocument(),
);
    fireEvent.click(screen.getByTestId("trigger-fn-option-audit_fn"));
    expect(onChange).toHaveBeenCalledWith({ schema: "public", name: "audit_fn" });
  });

  it("typing in the search input narrows the visible list", async () => {
    mockedList.mockResolvedValue([
      { name: "audit_fn", args: "", returnKind: "trigger", returnType: null },
      { name: "log_fn", args: "", returnKind: "trigger", returnType: null },
    ]);
    render(      <FunctionPicker
        value={{ schema: "public", name: "" }}
        onChange={() => {}}
        connId="c1"
        schema="public"
      />,
);
    await waitFor(() =>
      expect(screen.getByTestId("trigger-fn-option-audit_fn")).toBeInTheDocument(),
);
    fireEvent.change(screen.getByTestId("trigger-fn-picker-search"), { target: { value: "log" } });
    expect(screen.queryByTestId("trigger-fn-option-audit_fn")).toBeNull();
    expect(screen.getByTestId("trigger-fn-option-log_fn")).toBeInTheDocument();
  });
});
