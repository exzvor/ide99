/**
 * — Easy linter exports.
 */

export { EASY_RULES, type EasyLintRule } from "./rules";
export { lintSql, offsetToLineCol, type LintFinding } from "./lint";
export { lintFindingsToMarkers, type Locale } from "./lintMarkers";
export { useEasyLinter } from "./EasyLinterIntegration";
