/**
 * — 
 *
 * Pure conversion: Squawk findings → Monaco IMarkerData. Tested in
 * isolation so ApplyDialog's useEffect is just a thin glue layer.
 */

import { describe, expect, it } from "vitest";
import { findingsToMonacoMarkers } from "./lintMarkers";
import type { SquawkFinding } from "./lintStore";

describe("findingsToMonacoMarkers", () => {
  const findings: SquawkFinding[] = [
    {
      rule: "prefer-text-field",
      severity: "warning",
      file: "x",
      line: 5,
      column: 1,
      message: "Use text",
    },
    {
      rule: "ban-drop-database",
      severity: "error",
      file: "x",
      line: 10,
      column: 5,
      message: "Don't",
    },
  ];
  const descriptions = new Map([["prefer-text-field", "Use text instead of varchar."]]);

  it("converts each finding to a Monaco marker", () => {
    const m = findingsToMonacoMarkers(findings, descriptions);
    expect(m).toHaveLength(2);
  });

  it("maps severity correctly", () => {
    const m = findingsToMonacoMarkers(findings, descriptions);
    expect(m[0].severity).toBe(4); // monaco MarkerSeverity.Warning = 4
    expect(m[1].severity).toBe(8); // monaco MarkerSeverity.Error = 8
  });

  it("includes the rule description in the message when available", () => {
    const m = findingsToMonacoMarkers(findings, descriptions);
    expect(m[0].message).toContain("Use text");
    expect(m[0].message).toContain("Use text instead of varchar.");
  });

  it("falls back to just the message when description is unknown", () => {
    const m = findingsToMonacoMarkers(findings, new Map());
    expect(m[0].message).toContain("Use text");
    expect(m[0].message).not.toContain("instead of varchar");
  });

  it("normalizes column=0 to startColumn=1", () => {
    const f: SquawkFinding[] = [
      { rule: "r", severity: "warning", file: "x", line: 1, column: 0, message: "" },
    ];
    const m = findingsToMonacoMarkers(f, new Map());
    expect(m[0].startColumn).toBe(1);
  });
});
