/**
 * — 
 *
 * Pure conversion from Squawk findings into Monaco `IMarkerData[]`. The
 * Monaco severity numeric constants are inlined (8 = Error, 4 = Warning)
 * to avoid pulling the full `monaco-editor` runtime into a unit test.
 */

import type { editor } from "monaco-editor";
import type { SquawkFinding } from "./lintStore";

const SQUAWK_DOCS_BASE = "https://squawkhq.com/docs/";

const MARKER_SEVERITY_WARNING = 4;
const MARKER_SEVERITY_ERROR = 8;

/** Convert Squawk findings to Monaco IMarkerData[]. Pure function — testable in isolation. */
export function findingsToMonacoMarkers(  findings: SquawkFinding[],
  ruleDescriptions: Map<string, string>,
): editor.IMarkerData[] {
  return findings.map((f): editor.IMarkerData => {
    const desc = ruleDescriptions.get(f.rule);
    const message = desc ? `${f.message}\n\n${desc}` : f.message;
    const startColumn = Math.max(1, f.column);
    return {
      severity: f.severity === "error" ? MARKER_SEVERITY_ERROR : MARKER_SEVERITY_WARNING,
      message,
      startLineNumber: Math.max(1, f.line),
      startColumn,
      endLineNumber: Math.max(1, f.line),
      endColumn: startColumn + 1,
      source: "squawk",
      code: {
        value: f.rule,
        target: { toString: () => `${SQUAWK_DOCS_BASE}${f.rule}` } as { toString: () => string },
      } as editor.IMarkerData["code"],
    };
  });
}
