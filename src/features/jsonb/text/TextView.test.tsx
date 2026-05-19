import "../../../i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

interface MockEditorProps {
  value: string;
  language: string;
  onChange: (v: string) => void;
  options?: { readOnly?: boolean };
}

vi.mock("@monaco-editor/react", () => ({
  Editor: ({ value, language, onChange, options }: MockEditorProps) => (
    <textarea
      data-testid="mock-monaco"
      data-language={language}
      readOnly={options?.readOnly ?? false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { TextView } from "./TextView";

describe("TextView", () => {
  it("renders pretty-printed value", () => {
    render(<TextView value='{"a":1}' onChange={() => {}} readOnly={false} parseError={null} />);
    const ed = screen.getByTestId("mock-monaco") as HTMLTextAreaElement;
    expect(ed.value).toContain('"a": 1');
  });

  it("passes through invalid JSON unchanged (no pretty-print on parse error)", () => {
    render(<TextView value="not json" onChange={() => {}} readOnly={false} parseError={null} />);
    const ed = screen.getByTestId("mock-monaco") as HTMLTextAreaElement;
    expect(ed.value).toBe("not json");
  });

  it("uses language=json on the editor", () => {
    render(<TextView value='{"a":1}' onChange={() => {}} readOnly={false} parseError={null} />);
    expect(screen.getByTestId("mock-monaco")).toHaveAttribute("data-language", "json");
  });

  it("shows parse error banner with role=alert when parseError set", () => {
    render(
      <TextView
        value="not json"
        onChange={() => {}}
        readOnly={false}
        parseError="Unexpected token"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Unexpected token/);
  });

  it("hides parse error banner when parseError is null", () => {
    render(<TextView value='{"a":1}' onChange={() => {}} readOnly={false} parseError={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables editor when readOnly", () => {
    render(<TextView value='{"a":1}' onChange={() => {}} readOnly parseError={null} />);
    expect(screen.getByTestId("mock-monaco")).toHaveAttribute("readonly");
  });

  it("calls onChange when the editor emits a change", () => {
    const onChange = vi.fn();
    render(<TextView value='{"a":1}' onChange={onChange} readOnly={false} parseError={null} />);
    const ed = screen.getByTestId("mock-monaco") as HTMLTextAreaElement;
    fireEvent.change(ed, { target: { value: "{}" } });
    expect(onChange).toHaveBeenCalledWith("{}");
  });
});
