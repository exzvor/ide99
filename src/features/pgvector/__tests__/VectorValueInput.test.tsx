// — : smoke tests for the three-mode VectorValueInput.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type VectorValue,
  VectorValueInput,
  type VectorValueInputProps,
} from "../VectorValueInput";

function Harness(props: Partial<VectorValueInputProps> & { initial?: VectorValue }) {
  const [value, setValue] = useState<VectorValue>(    props.initial ?? { mode: "literal", literal: "" },
);
  return (    <VectorValueInput
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
      dimHint={props.dimHint}
    />
);
}

describe("VectorValueInput", () => {
  it("literal mode accepts a valid JSON array of numbers without showing an error", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial={{ mode: "literal", literal: "" }} />);

    const ta = screen.getByTestId("vector-input-literal") as HTMLTextAreaElement;
    // user-event treats `[` as modifier syntax — escape it.
    await userEvent.type(ta, "[[0.1, 0.2]");

    // Each keystroke emits one onChange.
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as VectorValue;
    expect(last).toEqual({ mode: "literal", literal: "[0.1, 0.2]" });
    // No validation error rendered for a well-formed JSON array of numbers.
    expect(screen.queryByTestId("vector-input-literal-error")).not.toBeInTheDocument();
  });

  it("literal mode shows an error for non-JSON-array input", () => {
    render(<VectorValueInput value={{ mode: "literal", literal: "[abc]" }} onChange={() => {}} />);
    const err = screen.getByTestId("vector-input-literal-error");
    expect(err).toBeInTheDocument();
    expect(err.textContent).toMatch(/invalid/i);
  });

  it("switching from literal → sql-fn fires onChange with mode='sql-fn' and an empty expr", async () => {
    const onChange = vi.fn();
    render(<VectorValueInput value={{ mode: "literal", literal: "[1, 2]" }} onChange={onChange} />);
    // Mode picker is a <select>; pick "sql-fn".
    const select = screen.getByTestId("vector-input-mode") as HTMLSelectElement;
    await userEvent.selectOptions(select, "sql-fn");

    expect(onChange).toHaveBeenCalledWith({ mode: "sql-fn", expr: "" });
  });

  it("sql-fn mode passes the typed expression through onChange", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial={{ mode: "sql-fn", expr: "" }} />);
    const input = screen.getByTestId("vector-input-sqlfn") as HTMLInputElement;
    await userEvent.type(input, "embed('hi')");
    const last = onChange.mock.calls.at(-1)?.[0] as VectorValue;
    expect(last).toEqual({ mode: "sql-fn", expr: "embed('hi')" });
  });

  it("the 'Generate embedding (v1.1)' stub button is disabled and unfocusable", () => {
    render(<VectorValueInput value={{ mode: "literal", literal: "" }} onChange={() => {}} />);
    const stub = screen.getByTestId("vector-input-stub-button") as HTMLButtonElement;
    expect(stub).toBeDisabled();
    expect(stub.getAttribute("tabindex")).toBe("-1");
  });

  it("renders the expected-dim hint when dimHint is provided", () => {
    render(      <VectorValueInput
        value={{ mode: "literal", literal: "" }}
        onChange={() => {}}
        dimHint={384}
      />,
);
    expect(screen.getByText(/expected dim: 384/i)).toBeInTheDocument();
  });
});
