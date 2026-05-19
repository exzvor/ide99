/**
 * — Easy linter engine.
 *
 * `lintSql(text)` runs each rule's regex-based matcher and returns a
 * flat array of {@link LintFinding} (with 1-based line/col + length +
 * rule reference). Caller (Monaco editor in Easy mode) converts to
 * `IMarkerData` with source = "easy-mistakes".
 *
 * Limitation: matchers do NOT parse SQL grammatically. Patterns inside
 * single-quoted strings or `--` line comments may produce false
 * positives. Acceptable trade-off — see rules.ts header.
 */

import { EASY_RULES, type EasyLintRule } from "./rules";

export interface LintFinding {
  /** Rule id (matches `EasyLintRule.id`). */
  ruleId: string;
  /** 1-based line offset in the input. */
  line: number;
  /** 1-based column offset of the offending token's start. */
  col: number;
  /** Length in characters of the offending token. */
  length: number;
  rule: EasyLintRule;
}

/** Convert a 0-based string offset to 1-based {line, col}. */
export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  if (offset <= 0) return { line: 1, col: 1 };
  const upTo = text.slice(0, offset);
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < upTo.length; i++) {
    if (upTo.charCodeAt(i) === 10 /* \n */) {
      line += 1;
      lastNl = i;
    }
  }
  const col = lastNl === -1 ? offset + 1 : offset - lastNl;
  return { line, col };
}

function ruleById(id: string): EasyLintRule {
  const rule = EASY_RULES.find((r) => r.id === id);
  if (!rule) {
    throw new Error(`easy-linter: unknown rule id "${id}"`);
  }
  return rule;
}

function pushFinding(
  out: LintFinding[],
  text: string,
  ruleId: string,
  offset: number,
  length: number,
): void {
  const { line, col } = offsetToLineCol(text, offset);
  out.push({ ruleId, line, col, length, rule: ruleById(ruleId) });
}

/** Run a /g regex; for every match, push a finding at `match.index` with `length`. */
function runRegex(
  out: LintFinding[],
  text: string,
  ruleId: string,
  pattern: RegExp,
  lengthOf?: (m: RegExpExecArray) => number,
): void {
  // Defensive copy so callers can pass a literal /flag pattern without lastIndex bleed.
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const length = lengthOf ? lengthOf(m) : m[0].length;
    pushFinding(out, text, ruleId, m.index, Math.max(1, length));
    if (m[0].length === 0) re.lastIndex += 1; // safety against zero-width matches
  }
}

// Statement bodies: split on `;` outside strings (good enough for Easy mode).
// Each entry is { body, offset } where offset is the index in the original text.
function statements(text: string): Array<{ body: string; offset: number }> {
  const out: Array<{ body: string; offset: number }> = [];
  let start = 0;
  let inSingle = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && text[i - 1] !== "\\") inSingle = !inSingle;
    if (!inSingle && c === ";") {
      out.push({ body: text.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (start < text.length) {
    out.push({ body: text.slice(start), offset: start });
  }
  return out;
}

/** Find a keyword (case-insensitive, word-boundary) in stmt body, return body-relative offset or -1. */
function findKeyword(body: string, keyword: string): number {
  const re = new RegExp(`\\b${keyword}\\b`, "i");
  const m = re.exec(body);
  return m ? m.index : -1;
}

// ─── Rule matchers ────────────────────────────────────────────────────

function ruleWhereEqNull(text: string, out: LintFinding[]): void {
  // WHERE col = NULL  /  col != NULL  /  col <> NULL
  // Capture starts at the operator+NULL chunk so the underline lands on the bug.
  runRegex(out, text, "where_eq_null", /(=|<>|!=)\s*null\b/gi, (m) => m[0].length);
}

function ruleSelectDistinctStar(text: string, out: LintFinding[]): void {
  runRegex(out, text, "select_distinct_star", /\bselect\s+distinct\s+\*/gi);
}

function ruleOrderByIndex(text: string, out: LintFinding[]): void {
  // ORDER BY 1, ORDER BY 1, 2  — mark each numeric index.
  const re = /\border\s+by\s+(\d+(?:\s*,\s*\d+)*)/gi;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    pushFinding(out, text, "order_by_index", m.index, m[0].length);
  }
}

function ruleLimitWithoutOrder(text: string, out: LintFinding[]): void {
  for (const stmt of statements(text)) {
    const limitRe = /\blimit\s+\d+/gi;
    const orderRe = /\border\s+by\b/i;
    for (let m = limitRe.exec(stmt.body); m !== null; m = limitRe.exec(stmt.body)) {
      const before = stmt.body.slice(0, m.index);
      if (orderRe.test(before)) continue;
      pushFinding(out, text, "limit_without_order", stmt.offset + m.index, m[0].length);
    }
  }
}

function ruleLikeNoWildcard(text: string, out: LintFinding[]): void {
  // LIKE 'literal-without-% or _'. Escape `\%` / `\_` are not handled — Easy.
  runRegex(out, text, "like_no_wildcard", /\blike\s+'[^'%_]*'/gi);
}

function ruleUpdateNoWhere(text: string, out: LintFinding[]): void {
  // UPDATE <ident> [<alias>] SET ... — only flag when no WHERE in the statement.
  for (const stmt of statements(text)) {
    const updateRe = /\bupdate\s+([\w."]+)/i;
    const um = updateRe.exec(stmt.body);
    if (!um) continue;
    // Must be the leading keyword of this statement (skip whitespace/comments).
    const lead = stmt.body.slice(0, um.index);
    if (lead.trim().length > 0) continue;
    if (!/\bset\b/i.test(stmt.body)) continue;
    if (/\bwhere\b/i.test(stmt.body)) continue;
    pushFinding(out, text, "update_no_where", stmt.offset + um.index, "update".length);
  }
}

function ruleDeleteNoWhere(text: string, out: LintFinding[]): void {
  for (const stmt of statements(text)) {
    const delRe = /\bdelete\s+from\s+([\w."]+)/i;
    const dm = delRe.exec(stmt.body);
    if (!dm) continue;
    const lead = stmt.body.slice(0, dm.index);
    if (lead.trim().length > 0) continue;
    if (/\bwhere\b/i.test(stmt.body)) continue;
    pushFinding(out, text, "delete_no_where", stmt.offset + dm.index, "delete".length);
  }
}

function ruleCrossJoinImplicit(text: string, out: LintFinding[]): void {
  // FROM a, b   (no JOIN keyword between them) AND no WHERE in the same stmt.
  for (const stmt of statements(text)) {
    if (!/\bselect\b/i.test(stmt.body)) continue;
    const fromIdx = findKeyword(stmt.body, "from");
    if (fromIdx === -1) continue;
    // Find next keyword that closes FROM list.
    const tail = stmt.body.slice(fromIdx);
    const closerRe =
      /\b(where|group\s+by|order\s+by|limit|having|window|union|intersect|except|returning)\b/i;
    const cm = closerRe.exec(tail);
    const fromList = cm ? tail.slice(0, cm.index) : tail;
    // Strip leading `from` itself.
    const list = fromList.replace(/^from\b/i, "");
    // Look for a top-level comma (not inside parens).
    let depth = 0;
    let hasTopLevelComma = false;
    let commaIdx = -1;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      else if (c === "," && depth === 0) {
        hasTopLevelComma = true;
        commaIdx = i;
        break;
      }
    }
    if (!hasTopLevelComma) continue;
    if (/\bjoin\b/i.test(list)) continue; // explicit join present; skip
    if (/\bwhere\b/i.test(stmt.body)) continue; // user filtered, no Cartesian
    const offsetInBody = fromIdx + "from".length + commaIdx;
    pushFinding(out, text, "cross_join_implicit", stmt.offset + offsetInBody, 1);
  }
}

function ruleCountStarDistinct(text: string, out: LintFinding[]): void {
  // COUNT(*) inside a statement that also has GROUP BY → maybe meant DISTINCT.
  for (const stmt of statements(text)) {
    if (!/\bgroup\s+by\b/i.test(stmt.body)) continue;
    const re = /\bcount\s*\(\s*\*\s*\)/gi;
    for (let m = re.exec(stmt.body); m !== null; m = re.exec(stmt.body)) {
      pushFinding(out, text, "count_star_distinct", stmt.offset + m.index, m[0].length);
    }
  }
}

function ruleUnqualifiedDrop(text: string, out: LintFinding[]): void {
  // DROP TABLE name  /  DROP VIEW name  — name without dot.
  // Lookahead `(?!\.)` ensures the captured identifier is NOT immediately
  // followed by a `.` (i.e., already schema-qualified).
  // `[\w"]+\b` followed by `(?![.\w"])` makes sure the identifier isn't
  // partially captured: backtracking won't help the engine because any
  // shorter prefix still ends with a `\w` immediately followed by another
  // `\w` (failing the negative lookahead).
  const re =
    /\bdrop\s+(?:table|view|index|sequence|materialized\s+view)(?:\s+if\s+exists)?\s+([\w"]+)(?![.\w"])/gi;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const ident = m[1];
    if (ident.includes(".")) continue;
    const identStart = m.index + m[0].lastIndexOf(ident);
    pushFinding(out, text, "unqualified_drop", identStart, ident.length);
  }
}

function ruleBoolNotEq(text: string, out: LintFinding[]): void {
  // = true, = false, <> true, <> false, != true/false
  runRegex(out, text, "bool_not_eq", /(=|<>|!=)\s*(true|false)\b/gi);
}

function ruleTypeCastSpaces(text: string, out: LintFinding[]): void {
  // ` :: type`  or `:: type` (whitespace around `::`). Skip the tight form.
  runRegex(out, text, "type_cast_double_colon_spaces", /(\s+::\s*\w|::\s+\w)/g);
}

const MATCHERS: Array<(text: string, out: LintFinding[]) => void> = [
  ruleWhereEqNull,
  ruleSelectDistinctStar,
  ruleOrderByIndex,
  ruleLimitWithoutOrder,
  ruleLikeNoWildcard,
  ruleUpdateNoWhere,
  ruleDeleteNoWhere,
  ruleCrossJoinImplicit,
  ruleCountStarDistinct,
  ruleUnqualifiedDrop,
  ruleBoolNotEq,
  ruleTypeCastSpaces,
];

/** Pure function — returns findings sorted by (line, col). */
export function lintSql(text: string): LintFinding[] {
  if (!text || text.length === 0) return [];
  const out: LintFinding[] = [];
  for (const matcher of MATCHERS) {
    try {
      matcher(text, out);
    } catch {
      // Defensive: a single broken matcher must not poison the whole linter.
    }
  }
  out.sort((a, b) => a.line - b.line || a.col - b.col);
  return out;
}
