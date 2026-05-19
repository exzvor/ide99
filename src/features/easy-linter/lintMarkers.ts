/**
 * — convert {@link LintFinding}s emitted by the easy-linter
 * into Monaco `IMarkerData[]`. Pure function — testable without booting
 * the editor. Mirrors the shape of `migrations/squawk/lintMarkers.ts`
 * but uses `source: "easy-mistakes"` so the two marker owners coexist.
 */

import type { editor } from "monaco-editor";
import type { LintFinding } from "./lint";

const MARKER_SEVERITY_INFO = 2;
const MARKER_SEVERITY_WARNING = 4;

export type Locale = "en" | "ru";

/**
 * Convert findings to Monaco IMarkerData. The `locale` selects which
 * EN/RU strings end up in the marker tooltip. `source` is fixed to
 * `"easy-mistakes"` so this owner does not collide with `"squawk"`.
 */
export function lintFindingsToMarkers(  findings: LintFinding[],
  locale: Locale = "en",
): editor.IMarkerData[] {
  return findings.map((f): editor.IMarkerData => {
    const startColumn = Math.max(1, f.col);
    const endColumn = startColumn + Math.max(1, f.length);
    const headline = f.rule.message[locale];
    const fixLine = f.rule.fix ? `\n\n${f.rule.fix[locale]}` : "";
    return {
      severity: f.rule.severity === "warning" ? MARKER_SEVERITY_WARNING : MARKER_SEVERITY_INFO,
      message: `${headline}${fixLine}`,
      startLineNumber: Math.max(1, f.line),
      startColumn,
      endLineNumber: Math.max(1, f.line),
      endColumn,
      source: "easy-mistakes",
      code: f.rule.id,
    };
  });
}
