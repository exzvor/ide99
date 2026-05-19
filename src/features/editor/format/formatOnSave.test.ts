import { describe, expect, it, vi } from "vitest";
import { applyFormat } from "./formatOnSave";

const fakeEditor = (initialValue: string) => {
  let value = initialValue;
  return {
    getValue: () => value,
    setValue: (v: string) => {
      value = v;
    },
    getModel: () => ({
      getValue: () => value,
      getFullModelRange: () => ({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: value.length + 1,
      }),
    }),
    executeEdits: vi.fn((_src: string, edits: Array<{ range: unknown; text: string }>) => {
      value = edits[0]?.text ?? value;
      return true;
    }),
    focus: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: test fixture proxy
  } as any;
};

describe("applyFormat", () => {
  it("formats valid SQL via single edit operation", () => {
    const ed = fakeEditor("select 1 from t");
    applyFormat(ed);
    expect(ed.executeEdits).toHaveBeenCalledTimes(1);
    expect(ed.getValue()).toMatch(/SELECT/);
  });

  it("no-op on parse failure (preserves buffer)", () => {
    const ed = fakeEditor("");
    applyFormat(ed);
    expect(ed.executeEdits).not.toHaveBeenCalled();
    expect(ed.getValue()).toBe("");
  });

  it("no-op when format result equals current buffer (idempotent re-format)", () => {
    const ed = fakeEditor("SELECT 1\nFROM t");
    applyFormat(ed);
    const callsAfterFirst = ed.executeEdits.mock.calls.length;
    applyFormat(ed);
    expect(ed.executeEdits.mock.calls.length).toBe(callsAfterFirst); // no second edit
  });
});
