// — owner: .
//
// Pure unit tests for the RFC-4180 CSV serializer used by the
// pg_stat_statements export.
import { describe, expect, it } from "vitest";

import { rowsToCsv } from "../csvExport";

describe("rowsToCsv", () => {
  it("serialises a basic 3-column / 2-row matrix without quoting", () => {
    const csv = rowsToCsv(
      ["a", "b", "c"],
      [
        ["1", "2", "3"],
        ["4", "5", "6"],
      ],
    );
    expect(csv).toBe("a,b,c\n1,2,3\n4,5,6");
  });

  it("wraps and double-quotes cells containing commas", () => {
    const csv = rowsToCsv(["x"], [["hello, world"]]);
    expect(csv).toBe('x\n"hello, world"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    const csv = rowsToCsv(["x"], [['she said "hi"']]);
    expect(csv).toBe('x\n"she said ""hi"""');
  });

  it("wraps cells containing newlines or carriage returns", () => {
    const csv = rowsToCsv(["x"], [["line1\nline2"], ["line1\rline2"]]);
    expect(csv).toBe('x\n"line1\nline2"\n"line1\rline2"');
  });

  it("renders null as an empty unquoted cell", () => {
    const csv = rowsToCsv(
      ["a", "b"],
      [
        [null, "v"],
        ["w", null],
      ],
    );
    expect(csv).toBe("a,b\n,v\nw,");
  });

  it("passes Unicode characters through unchanged", () => {
    const csv = rowsToCsv(
      ["lang", "greeting"],
      [
        ["ru", "Привет, мир"],
        ["jp", "こんにちは"],
        ["emoji", "🚀"],
      ],
    );
    // The Russian greeting contains a comma and must be quoted.
    expect(csv).toBe('lang,greeting\nru,"Привет, мир"\njp,こんにちは\nemoji,🚀');
  });

  it("emits header-only output when rows is empty", () => {
    const csv = rowsToCsv(["a", "b"], []);
    expect(csv).toBe("a,b\n");
  });

  it("quotes header cells that contain delimiters", () => {
    const csv = rowsToCsv(["a,b", "c"], [["1", "2"]]);
    expect(csv).toBe('"a,b",c\n1,2');
  });
});
