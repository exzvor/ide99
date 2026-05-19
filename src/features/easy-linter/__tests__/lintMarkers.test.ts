/**
 * — pure conversion of LintFinding[] → IMarkerData[].
 */

import { describe, expect, it } from "vitest";
import type { LintFinding } from "../lint";
import { lintFindingsToMarkers } from "../lintMarkers";
import { EASY_RULES } from "../rules";

function findingFor(id: string, line = 1, col = 1, length = 5): LintFinding {
  const rule = EASY_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown rule ${id}`);
  return { ruleId: id, line, col, length, rule };
}

describe("lintFindingsToMarkers", () => {
  it("maps warning severity to Monaco 4", () => {
    const m = lintFindingsToMarkers([findingFor("where_eq_null")]);
    expect(m).toHaveLength(1);
    expect(m[0].severity).toBe(4);
  });

  it("maps info severity to Monaco 2", () => {
    const m = lintFindingsToMarkers([findingFor("select_distinct_star")]);
    expect(m[0].severity).toBe(2);
  });

  it("uses source 'easy-mistakes'", () => {
    const m = lintFindingsToMarkers([findingFor("where_eq_null")]);
    expect(m[0].source).toBe("easy-mistakes");
  });

  it("includes rule id as code", () => {
    const m = lintFindingsToMarkers([findingFor("where_eq_null")]);
    expect(m[0].code).toBe("where_eq_null");
  });

  it("renders EN headline by default", () => {
    const m = lintFindingsToMarkers([findingFor("where_eq_null")]);
    expect(m[0].message).toContain("Comparison with NULL");
  });

  it("renders RU headline when locale = ru", () => {
    const m = lintFindingsToMarkers([findingFor("where_eq_null")], "ru");
    expect(m[0].message).toContain("Сравнение с NULL");
  });

  it("appends fix when present", () => {
    const m = lintFindingsToMarkers([findingFor("where_eq_null")]);
    expect(m[0].message).toContain("IS NULL");
  });

  it("clamps startColumn to >= 1", () => {
    const f = findingFor("where_eq_null", 1, 0, 3);
    const m = lintFindingsToMarkers([f]);
    expect(m[0].startColumn).toBe(1);
  });

  it("computes endColumn = startColumn + length", () => {
    const f = findingFor("where_eq_null", 5, 7, 4);
    const m = lintFindingsToMarkers([f]);
    expect(m[0].startColumn).toBe(7);
    expect(m[0].endColumn).toBe(11);
    expect(m[0].startLineNumber).toBe(5);
    expect(m[0].endLineNumber).toBe(5);
  });
});
