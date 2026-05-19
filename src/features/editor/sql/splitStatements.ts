/**
 * SQL-aware statement splitter for the editor.
 *
 * Pure module — no project imports. Recognises single/double-quoted strings,
 * E-strings, dollar-quoted blocks (with and without tags), line comments,
 * and PG-style nested block comments. Anything not inside one of those
 * contexts is split on `;`.
 */

export interface Statement {
  /** Trimmed text without trailing `;` and without leading/trailing whitespace. */
  text: string;
  /** Offsets in the source text, INCLUDING the trailing `;`. */
  startOffset: number;
  endOffset: number;
  /** 1-indexed for Monaco gutter decorations. */
  startLine: number;
  endLine: number;
}

const WHITESPACE = /\s/;

/**
 * Find the matching dollar-quote tag at `i` (which points at `$`). Returns
 * the full opener including both `$` characters (e.g. `"$$"` or `"$tag$"`)
 * or null if the position is not actually a dollar-quote opener.
 */
function readDollarOpener(sql: string, i: number): string | null {
  if (sql[i] !== "$") return null;
  let j = i + 1;
  while (j < sql.length) {
    const c = sql[j];
    if (c === "$") return sql.slice(i, j + 1);
    if (!/[A-Za-z0-9_]/.test(c)) return null;
    j++;
  }
  return null;
}

/**
 * Walk forward from `i` (which is just past the opener) until we find a
 * matching `closer` or end of input. Returns the offset of the FIRST char
 * after the closer (or sql.length if unterminated).
 */
function skipToClose(sql: string, from: number, closer: string): number {
  const idx = sql.indexOf(closer, from);
  if (idx === -1) return sql.length;
  return idx + closer.length;
}

function lineOf(sql: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < sql.length; i++) {
    if (sql[i] === "\n") line++;
  }
  return line;
}

/**
 * Skip leading whitespace and SQL comments in `segment` starting at `from`.
 * Returns the index of the first character that is neither whitespace nor a
 * comment (or `segment.length` if the rest is entirely comments/whitespace).
 */
function skipLeadingCommentsAndWs(segment: string, from: number): number {
  let i = from;
  while (i < segment.length) {
    const c = segment[i];
    const next = segment[i + 1];
    if (WHITESPACE.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && next === "-") {
      const nl = segment.indexOf("\n", i + 2);
      i = nl === -1 ? segment.length : nl + 1;
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < segment.length && depth > 0) {
        if (segment[i] === "/" && segment[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (segment[i] === "*" && segment[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }
    break;
  }
  return i;
}

/**
 * Returns true if `segment` consists exclusively of SQL comments and
 * whitespace — i.e. no real statement text.
 */
function isCommentsOnly(segment: string): boolean {
  return skipLeadingCommentsAndWs(segment, 0) >= segment.length;
}

export function splitStatements(sql: string): Statement[] {
  const stmts: Statement[] = [];
  let segStart = 0;
  let i = 0;

  const flush = (segEndExclusive: number) => {
    const segment = sql.slice(segStart, segEndExclusive);
    const stripSemi = segment.replace(/;\s*$/, "");
    if (stripSemi.trim().length === 0 || isCommentsOnly(stripSemi)) {
      segStart = segEndExclusive;
      return;
    }
    // Strip leading whitespace + leading SQL comments from the user-visible
    // text so a "header" comment doesn't bleed into `.text`. Then strip
    // trailing whitespace (we already stripped the trailing `;`).
    const textStart = skipLeadingCommentsAndWs(stripSemi, 0);
    let textEnd = stripSemi.length;
    while (textEnd > textStart && WHITESPACE.test(stripSemi[textEnd - 1])) textEnd--;
    const text = stripSemi.slice(textStart, textEnd);
    // startLine/endLine should reflect where the user-visible text starts
    // and ends, not the segment's leading/trailing whitespace (which may
    // include the `\n` after a previous `;` or a leading header comment).
    stmts.push({
      text,
      startOffset: segStart,
      endOffset: segEndExclusive,
      startLine: lineOf(sql, segStart + textStart),
      endLine: lineOf(sql, segStart + Math.max(textStart, textEnd - 1)),
    });
    segStart = segEndExclusive;
  };

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    // Line comment: -- ... \n
    if (c === "-" && next === "-") {
      const nl = sql.indexOf("\n", i + 2);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    // Block comment with PG-style nesting
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }
    // E-string: E'...\\'...'
    if ((c === "E" || c === "e") && next === "'") {
      i += 2;
      while (i < sql.length) {
        if (sql[i] === "\\" && i + 1 < sql.length) {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Single-quoted string with `''` escape
    if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Double-quoted identifier with `""` escape
    if (c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Dollar-quoted block
    if (c === "$") {
      const opener = readDollarOpener(sql, i);
      if (opener) {
        i += opener.length;
        i = skipToClose(sql, i, opener);
        continue;
      }
    }
    // Statement terminator
    if (c === ";") {
      flush(i + 1);
      i++;
      continue;
    }
    i++;
  }

  // Tail (no trailing `;`)
  if (segStart < sql.length) {
    flush(sql.length);
  }

  return stmts;
}

export function statementAtCursor(stmts: Statement[], cursorOffset: number): Statement | null {
  if (stmts.length === 0) return null;
  for (const s of stmts) {
    if (cursorOffset >= s.startOffset && cursorOffset <= s.endOffset) {
      return s;
    }
  }
  // Cursor is in inter-statement whitespace/comment → favour the next
  // statement; if no later statement, fall back to the previous one.
  for (const s of stmts) {
    if (cursorOffset < s.startOffset) return s;
  }
  return stmts[stmts.length - 1];
}
