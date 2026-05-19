/**
 * — SQL lexer + scope tracker.
 *
 * The tokenizer is hand-written because:
 * (a) it has to tolerate the partial-input typed by the user (unclosed strings,
 * unbalanced parens, incomplete keywords) without crashing or hanging, and
 * (b) latency budget is <50ms across the whole completion pipeline; a token
 * pass over an 8KB SQL fragment lands at ~1ms in our bench, which leaves
 * headroom for the scope analyzer + ranker.
 *
 * Output shape: a Token[] terminated by an `eof` sentinel. Tokens carry their
 * verbatim text so the scope analyzer can do case-insensitive keyword matching
 * (we lowercase on demand) while still surfacing the user's casing where it
 * matters (quoted identifiers).
 */

export type TokenKind =
  | "ident" // unquoted identifier or unrecognised word
  | "qident" // "double-quoted" identifier
  | "keyword" // unquoted SQL keyword (subset, see KEYWORDS)
  | "string" // 'single-quoted' or $tag$dollar-quoted$tag$
  | "number" // 123, 12.5, .5, 1e10
  | "punct" // . , ;  [ ]
  | "operator" // + - * / < > = ! % | & ^ ~ ?
  | "ws" // any whitespace including newlines
  | "comment" // -- line or /* block (possibly nested) */
  | "eof";

export interface Token {
  kind: TokenKind;
  text: string;
  /** Byte offset into the original source (UTF-16 code-units; matches Monaco). */
  start: number;
  /** End offset, exclusive. */
  end: number;
}

const KEYWORDS = new Set<string>([
  "select",
  "from",
  "where",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "outer",
  "cross",
  "lateral",
  "on",
  "using",
  "as",
  "with",
  "recursive",
  "and",
  "or",
  "not",
  "null",
  "is",
  "in",
  "exists",
  "between",
  "like",
  "ilike",
  "any",
  "all",
  "case",
  "when",
  "then",
  "else",
  "end",
  "group",
  "by",
  "order",
  "having",
  "limit",
  "offset",
  "fetch",
  "rows",
  "only",
  "first",
  "next",
  "values",
  "insert",
  "into",
  "update",
  "set",
  "delete",
  "returning",
  "create",
  "table",
  "view",
  "materialized",
  "index",
  "if",
  "exists",
  "primary",
  "key",
  "foreign",
  "references",
  "default",
  "unique",
  "check",
  "constraint",
  "alter",
  "add",
  "drop",
  "column",
  "rename",
  "to",
  "union",
  "intersect",
  "except",
  "distinct",
  "over",
  "partition",
  "window",
  "session",
  "local",
  "true",
  "false",
  "asc",
  "desc",
  "nulls",
  "unknown",
]);

const SINGLE_PUNCT = new Set<string>([".", ",", ";", "(", ")", "[", "]"]);
const OPERATOR_CHARS = new Set<string>([
  "+",
  "-",
  "*",
  "/",
  "<",
  ">",
  "=",
  "!",
  "%",
  "|",
  "&",
  "^",
  "~",
  "?",
]);

function isIdentStart(ch: string): boolean {
  // Conservative: ASCII letter or underscore. Cyrillic / extended chars are only
  // accepted inside double-quoted identifiers (PG's standard rule).
  return /[A-Za-z_]/.test(ch);
}

function isIdentCont(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const start = i;
    const ch = src[i];

    // whitespace
    if (/\s/.test(ch)) {
      while (i < n && /\s/.test(src[i])) i++;
      out.push({ kind: "ws", text: src.slice(start, i), start, end: i });
      continue;
    }

    // line comment
    if (ch === "-" && src[i + 1] === "-") {
      while (i < n && src[i] !== "\n") i++;
      out.push({ kind: "comment", text: src.slice(start, i), start, end: i });
      continue;
    }

    // block comment (possibly nested)
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out.push({ kind: "comment", text: src.slice(start, i), start, end: i });
      continue;
    }

    // single-quoted string with '' escape
    if (ch === "'") {
      i++;
      while (i < n) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out.push({ kind: "string", text: src.slice(start, i), start, end: i });
      continue;
    }

    // dollar-quoted string $tag$ … $tag$ (tag may be empty)
    if (ch === "$") {
      // Try to read a tag: $[A-Za-z_][A-Za-z0-9_]*$
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      if (j < n && src[j] === "$") {
        const tag = src.slice(i, j + 1); // includes both $
        i = j + 1;
        const closer = tag;
        const idx = src.indexOf(closer, i);
        i = idx === -1 ? n : idx + closer.length;
        out.push({ kind: "string", text: src.slice(start, i), start, end: i });
        continue;
      }
      // Bare $ — fall through to operator
    }

    // double-quoted identifier with "" escape (Cyrillic OK inside)
    if (ch === '"') {
      i++;
      while (i < n) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out.push({ kind: "qident", text: src.slice(start, i), start, end: i });
      continue;
    }

    // number
    if (isDigit(ch)) {
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (src[i] === "." && isDigit(src[i + 1])) {
        i++;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      if (src[i] === "e" || src[i] === "E") {
        i++;
        if (src[i] === "+" || src[i] === "-") i++;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      out.push({ kind: "number", text: src.slice(start, i), start, end: i });
      continue;
    }

    // identifier or keyword
    if (isIdentStart(ch)) {
      while (i < n && isIdentCont(src[i])) i++;
      const text = src.slice(start, i);
      const kind: TokenKind = KEYWORDS.has(text.toLowerCase()) ? "keyword" : "ident";
      out.push({ kind, text, start, end: i });
      continue;
    }

    // single-char punct
    if (SINGLE_PUNCT.has(ch)) {
      i++;
      out.push({ kind: "punct", text: ch, start, end: i });
      continue;
    }

    // operator chars (eat a contiguous run so `<=`, `<>` come out as one token)
    if (OPERATOR_CHARS.has(ch) || ch === "$") {
      while (i < n && (OPERATOR_CHARS.has(src[i]) || src[i] === "$")) i++;
      out.push({ kind: "operator", text: src.slice(start, i), start, end: i });
      continue;
    }

    // anything else: consume one char as punct so the loop progresses
    i++;
    out.push({ kind: "punct", text: ch, start, end: i });
  }

  out.push({ kind: "eof", text: "", start: n, end: n });
  return out;
}

// ---------------------------------------------------------------------------
// Scope analyzer
// ---------------------------------------------------------------------------

import type { AutocompletePathSegment, Clause, CteScope, FromAlias, Scope, Trigger } from "./types";

interface ScopeFrame {
  ctes: CteScope[];
  fromAliases: FromAlias[];
  clause: Clause;
  /** Tracks whether we're currently positioned to read aliases after FROM/JOIN. */
  expectingAlias: { for: FromAlias } | null;
  /** When walking `(SELECT a, b FROM t)` we collect projected idents to feed back as inline columns. */
  projectedColumns: string[] | null;
}

function newFrame(): ScopeFrame {
  return {
    ctes: [],
    fromAliases: [],
    clause: "unknown",
    expectingAlias: null,
    projectedColumns: null,
  };
}

const CLAUSE_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "group",
  "order",
  "having",
  "set",
  "values",
  "join",
  "left",
  "right",
  "full",
  "inner",
  "cross",
  "lateral",
  "on",
  "using",
]);

function matchJsonbPath(prefix: string): Extract<Trigger, { kind: "jsonb-path" }> | null {
  // Uses a global regex to find the RIGHT-MOST JSONB-path opening in the prefix.
  // The partial group stops at the first whitespace/quote/backslash so that when
  // the full SQL buffer is passed in (cursor at text.length), we don't swallow
  // subsequent tokens into the partial string.
  //
  // - (?:^|[^\w."'])      : separator before the column ident, or start of input.
  // - (?:(\w+)\s*\.\s*)?  : optional alias.
  // - (\w+)               : the column identifier.
  // - ((?:\s*->\s*(?:'(?:[^'\\]|\\.)*'|\d+))*) : zero or more -> chain segments
  // (single-quoted string keys or bare numeric indices).
  // - \s*->>?\s*'          : the final ->' or ->>' that opens the partial.
  // - ([^\s'\\]*)          : the partial key being typed — stops at whitespace,
  // closing quote, or backslash.
  const re =
    /(?:^|[^\w."'])((?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*))((?:\s*->\s*(?:'(?:[^'\\]|\\.)*'|\d+))*)\s*->>?\s*'([^\s'\\]*)/g;

  // Collect all matches and take the last one (rightmost JSONB-path opening).
  let m: RegExpExecArray | null = null;
  let lastMatch: RegExpExecArray | null = null;
  while ((m = re.exec(prefix)) !== null) {
    lastMatch = m;
    // Advance by 1 from match start to allow overlapping searches.
    re.lastIndex = m.index + 1;
  }
  if (!lastMatch) return null;

  const alias = lastMatch[2] ?? null;
  const column = lastMatch[3];
  const chain = lastMatch[4] ?? "";
  const partial = lastMatch[5];

  // Parse the chain into AutocompletePathSegment[].
  const segments: AutocompletePathSegment[] = [];
  const segRe = /->\s*(?:'((?:[^'\\]|\\.)*)'|(\d+))/g;
  let mm: RegExpExecArray | null;
  while ((mm = segRe.exec(chain))) {
    if (mm[1] !== undefined) {
      segments.push({ key: mm[1] });
    } else {
      const n = Number.parseInt(mm[2]!, 10);
      if (!Number.isNaN(n)) {
        segments.push({ arrayIndex: n });
      }
    }
  }

  return {
    kind: "jsonb-path",
    alias,
    column,
    path: segments,
    partial,
  };
}

function detectTrigger(
  prefix: string,
  tokens: import("./scope").Token[],
): { trigger: Trigger; identPrefix: string } {
  // Check jsonb-path FIRST: e.g. `data->>'us` (single-quote partial after JSONB op).
  const jsonbMatch = matchJsonbPath(prefix);
  if (jsonbMatch !== null) {
    // identPrefix is the partial key, used by Monaco for filterText.
    return { trigger: jsonbMatch, identPrefix: jsonbMatch.partial };
  }

  // Walk the tail of `tokens` (skipping ws/comments/eof) to detect the trigger context.
  // We're interested in: the last meaningful token and the one before it.
  const meaningful: import("./scope").Token[] = tokens.filter(
    (t) => t.kind !== "ws" && t.kind !== "comment" && t.kind !== "eof",
  );
  const last = meaningful[meaningful.length - 1];
  const prev = meaningful[meaningful.length - 2];

  // Trailing partial quoted ident: `…"Foo` (open quote, no close).
  // Detect this BEFORE alias-dot because `"Foo"."` has a trailing unterminated quote
  // and the lexer will emit it as a `qident` token (it eats to EOF).
  if (prefix.match(/"[^"]*$/)) {
    const partialMatch = prefix.match(/"([^"]*)$/);
    return {
      trigger: { kind: "quote", partial: partialMatch ? partialMatch[1] : "" },
      identPrefix: partialMatch ? partialMatch[1] : "",
    };
  }

  // Cursor position is the end of the prefix string. If the very last char is `.`
  // we're in alias-dot or schema-dot mode regardless of what came before.
  if (prefix.endsWith(".") && last && last.kind === "punct" && last.text === ".") {
    if (prev?.kind === "ident" || prev?.kind === "qident") {
      const name = prev.kind === "qident" ? prev.text.slice(1, -1).replace(/""/g, '"') : prev.text;
      // Heuristic: `schema.` if the name matches no FROM alias (caller in analyzeScope
      // disambiguates against the schema-cache); pre-classify as alias-dot here, the
      // ranker decides which list to use.
      return { trigger: { kind: "alias-dot", alias: name }, identPrefix: "" };
    }
  }

  // Trailing partial unquoted identifier: take the run of [A-Za-z0-9_] at the end.
  const tail = prefix.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  if (tail) {
    return { trigger: { kind: "letter" }, identPrefix: tail[0] };
  }

  return { trigger: { kind: "ctrl-space" }, identPrefix: "" };
}

/**
 * Analyse the SQL `text` and produce the scope visible at `cursorOffset`.
 *
 * The analyzer is a single forward pass with a stack of frames — every `(` opens
 * a new frame (subquery candidate); every matching `)` pops back. WITH-clauses
 * register CTEs into the *current* frame so the user sees them inside the
 * outer SELECT.
 *
 * Cursor handling ():
 * - Tokens are emitted for the WHOLE `text`, not just the part before the
 * cursor. This lets us collect FROM aliases that appear AFTER the cursor
 * (typing `SELECT u.\nFROM t u …` should still resolve `u` to `t`).
 * - The frame *reference* visible at the cursor is captured the first time
 * a token starts at or past `cursorOffset`; ctes/fromAliases are read
 * through that reference, so they keep populating as the walk continues.
 * - The frame's `clause` is captured by VALUE at cursor time, because we
 * don't want a later `FROM`/`WHERE` keyword to retroactively shift what
 * the user "is in" from the cursor's perspective.
 * - Trigger detection still runs on the prefix (`text.slice(0, cursor)`)
 * so an end-of-prefix `.` produces an `alias-dot` trigger correctly.
 *
 * Backwards compatibility: `cursorOffset` defaults to `text.length`, which
 * preserves the original "cursor at end of input" semantics that the unit
 * tests in scope.test.ts rely on.
 */
export function analyzeScope(text: string, cursorOffset?: number): Scope {
  const tokens = tokenize(text);
  const cursor = cursorOffset ?? text.length;
  const stack: ScopeFrame[] = [newFrame()];

  // Helper: peek at the active frame.
  const top = (): ScopeFrame => stack[stack.length - 1];

  // Snapshot the frame visible AT cursor and the clause it was in. Captured
  // as soon as the walk reaches a token at-or-past the cursor offset.
  let cursorFrame: ScopeFrame | null = null;
  let cursorClause: Clause = "unknown";

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];

    // Capture cursor-time frame BEFORE processing this token: any token whose
    // start is >= cursor sits AFTER the caret, so the active frame at this
    // moment is what the user "is in".
    if (cursorFrame === null && tok.start >= cursor) {
      cursorFrame = top();
      cursorClause = cursorFrame.clause;
    }

    if (tok.kind === "ws" || tok.kind === "comment" || tok.kind === "eof") {
      i++;
      continue;
    }

    // open paren — push a new frame, but inherit visible CTEs from the parent.
    // Special-cases:
    // - inside FROM/JOIN clause we're entering a subquery; register a placeholder
    // FromAlias on the parent so closing `)` can attach projected columns.
    // - inside VALUES the parenthesised group is still part of the values list;
    // propagate the clause to the child frame.
    if (tok.kind === "punct" && tok.text === "(") {
      const parent = top();
      if (parent.clause === "from" || parent.clause === "join") {
        const placeholder: FromAlias = { alias: "" };
        parent.fromAliases.push(placeholder);
        parent.expectingAlias = { for: placeholder };
      }
      const child = newFrame();
      child.ctes = [...parent.ctes];
      if (parent.clause === "values") {
        child.clause = "values";
      }
      stack.push(child);
      i++;
      continue;
    }

    // close paren — pop, attempt to attach projected columns to the parent's pending alias
    if (tok.kind === "punct" && tok.text === ")") {
      if (stack.length > 1) {
        const finished = stack.pop();
        // If the parent is awaiting a subquery alias, stash the projected columns there.
        const parent = top();
        if (parent.expectingAlias && finished) {
          parent.expectingAlias.for.columns = finished.projectedColumns ?? undefined;
          // Consume an optional alias right after the `)`: `(SELECT …) [AS] sub`.
          let k = i + 1;
          while (k < tokens.length && (tokens[k].kind === "ws" || tokens[k].kind === "comment"))
            k++;
          // skip optional AS
          if (tokens[k]?.kind === "keyword" && tokens[k].text.toLowerCase() === "as") {
            k++;
            while (k < tokens.length && (tokens[k].kind === "ws" || tokens[k].kind === "comment"))
              k++;
          }
          const aliasCandidate = tokens[k];
          if (
            aliasCandidate &&
            (aliasCandidate.kind === "ident" || aliasCandidate.kind === "qident") &&
            !(
              aliasCandidate.kind === "ident" &&
              CLAUSE_KEYWORDS.has(aliasCandidate.text.toLowerCase())
            )
          ) {
            parent.expectingAlias.for.alias =
              aliasCandidate.kind === "qident"
                ? aliasCandidate.text.slice(1, -1)
                : aliasCandidate.text;
            i = k;
          }
          parent.expectingAlias = null;
        }
      }
      i++;
      continue;
    }

    // keyword-driven clause transitions in the current frame
    if (tok.kind === "keyword") {
      const lower = tok.text.toLowerCase();

      if (lower === "with") {
        // Collect CTE names: "with [recursive] name [(col,col)] as (…)"
        let j = i + 1;
        // skip optional "recursive"
        while (j < tokens.length && (tokens[j].kind === "ws" || tokens[j].kind === "comment")) j++;
        if (tokens[j]?.kind === "keyword" && tokens[j].text.toLowerCase() === "recursive") {
          j++;
        }
        // a chain of `name AS (…), name AS (…), …`
        while (j < tokens.length) {
          while (j < tokens.length && (tokens[j].kind === "ws" || tokens[j].kind === "comment"))
            j++;
          const nameTok = tokens[j];
          if (!nameTok || (nameTok.kind !== "ident" && nameTok.kind !== "qident")) break;
          const cteName = nameTok.kind === "qident" ? nameTok.text.slice(1, -1) : nameTok.text;
          // skip until `(` (body-open) or comma (next CTE) or non-CTE keyword
          let k = j + 1;
          let bodyStart = -1;
          while (k < tokens.length) {
            if (tokens[k].kind === "punct" && tokens[k].text === "(") {
              bodyStart = k;
              break;
            }
            if (tokens[k].kind === "punct" && tokens[k].text === ",") break;
            if (tokens[k].kind === "keyword") {
              const lk = tokens[k].text.toLowerCase();
              if (lk === "select" || lk === "insert" || lk === "update" || lk === "delete") break;
            }
            k++;
          }
          if (bodyStart === -1) {
            top().ctes.push({ name: cteName });
            break;
          }
          // walk to matching `)`, collecting projected columns from the inner SELECT-list
          const cteCols = collectProjectedColumns(tokens, bodyStart);
          top().ctes.push({ name: cteName, columns: cteCols.columns });
          j = cteCols.endIdx + 1;
          // skip optional comma
          while (j < tokens.length && (tokens[j].kind === "ws" || tokens[j].kind === "comment"))
            j++;
          if (tokens[j]?.kind === "punct" && tokens[j].text === ",") {
            j++;
            continue;
          }
          break;
        }
        i = j;
        continue;
      }

      if (lower === "select") {
        top().clause = "select-list";
        // start tracking projected columns of the inner-most frame
        top().projectedColumns = [];
        i++;
        continue;
      }
      if (lower === "from") {
        top().clause = "from";
        top().expectingAlias = null;
        i++;
        continue;
      }
      if (
        lower === "join" ||
        lower === "inner" ||
        lower === "left" ||
        lower === "right" ||
        lower === "full" ||
        lower === "cross" ||
        lower === "lateral"
      ) {
        top().clause = "join";
        top().expectingAlias = null;
        i++;
        continue;
      }
      if (lower === "where") {
        top().clause = "where";
        i++;
        continue;
      }
      if (lower === "group") {
        top().clause = "group-by";
        i++;
        continue;
      }
      if (lower === "order") {
        top().clause = "order-by";
        i++;
        continue;
      }
      if (lower === "having") {
        top().clause = "having";
        i++;
        continue;
      }
      if (lower === "set") {
        top().clause = "set";
        i++;
        continue;
      }
      if (lower === "values") {
        top().clause = "values";
        i++;
        continue;
      }
      if (lower === "as") {
        // The next ident becomes the alias for the most recent FROM/subquery target.
        i++;
        while (i < tokens.length && (tokens[i].kind === "ws" || tokens[i].kind === "comment")) i++;
        const aliasTok = tokens[i];
        if (aliasTok && (aliasTok.kind === "ident" || aliasTok.kind === "qident")) {
          const aliasName = aliasTok.kind === "qident" ? aliasTok.text.slice(1, -1) : aliasTok.text;
          const frame = top();
          if (frame.clause === "select-list" && frame.projectedColumns !== null) {
            // SELECT-list AS rename: overwrite the most recent projected column
            // (e.g. `max(u.id) AS m` → projected name is "m", not "max").
            if (frame.projectedColumns.length > 0) {
              frame.projectedColumns[frame.projectedColumns.length - 1] = aliasName;
            } else {
              frame.projectedColumns.push(aliasName);
            }
          } else {
            const last = frame.fromAliases[frame.fromAliases.length - 1];
            if (last) last.alias = aliasName;
          }
        }
        i++;
        continue;
      }
      // Other keywords are noise from a scope point of view.
      i++;
      continue;
    }

    // identifier handling — only meaningful in FROM/JOIN clauses
    if (tok.kind === "ident" || tok.kind === "qident") {
      const name = tok.kind === "qident" ? tok.text.slice(1, -1) : tok.text;
      const frame = top();
      if (frame.clause === "from" || frame.clause === "join") {
        // schema-qualified: `schema.table` — peek for the dot
        let j = i + 1;
        while (j < tokens.length && (tokens[j].kind === "ws" || tokens[j].kind === "comment")) j++;
        let schema: string | undefined;
        let relName = name;
        if (tokens[j]?.kind === "punct" && tokens[j].text === ".") {
          // consume `schema.table`
          let k = j + 1;
          while (k < tokens.length && (tokens[k].kind === "ws" || tokens[k].kind === "comment"))
            k++;
          const next = tokens[k];
          if (next && (next.kind === "ident" || next.kind === "qident")) {
            schema = name;
            relName = next.kind === "qident" ? next.text.slice(1, -1) : next.text;
            i = k;
          }
        }
        const alias: FromAlias = {
          alias: relName,
          relation: { schema, name: relName },
        };
        frame.fromAliases.push(alias);
        frame.expectingAlias = { for: alias };
        i++;
        // optional explicit/implicit alias right after the table name
        let k = i;
        while (k < tokens.length && (tokens[k].kind === "ws" || tokens[k].kind === "comment")) k++;
        const aliasCandidate = tokens[k];
        if (
          aliasCandidate &&
          (aliasCandidate.kind === "ident" || aliasCandidate.kind === "qident") &&
          // not a keyword-like noise
          !(
            aliasCandidate.kind === "ident" &&
            CLAUSE_KEYWORDS.has(aliasCandidate.text.toLowerCase())
          )
        ) {
          alias.alias =
            aliasCandidate.kind === "qident"
              ? aliasCandidate.text.slice(1, -1)
              : aliasCandidate.text;
          i = k + 1;
        }
        continue;
      }
      if (frame.clause === "select-list" && frame.projectedColumns !== null) {
        // Plain projected ident — push it (later AS overrides happen below).
        frame.projectedColumns.push(name);
      }
      i++;
      continue;
    }

    if (tok.kind === "punct" && tok.text === ",") {
      // Just a separator — clauses persist; FROM-aliases are still accumulating in the same frame.
      i++;
      continue;
    }

    i++;
  }

  // Cursor sits past every token (e.g. cursor at end of input, or input is
  // shorter than expected) — fall back to the inner-most frame at end of walk.
  if (cursorFrame === null) {
    cursorFrame = top();
    cursorClause = cursorFrame.clause;
  }

  // Trigger detection runs on the prefix-only token list, not the full walk:
  // a trailing `.` only counts as alias-dot when it's literally at the cursor.
  const prefixText = text.slice(0, cursor);
  const prefixTokens = tokens.filter((t) => t.start < cursor);
  const { trigger, identPrefix } = detectTrigger(prefixText, prefixTokens);

  return {
    ctes: cursorFrame.ctes,
    fromAliases: cursorFrame.fromAliases,
    clause: cursorClause,
    trigger,
    prefix: identPrefix,
  };
}

/**
 * Walk a parenthesised body starting at `openIdx` (which points at the `(` token)
 * and return the projected columns of its top-level SELECT, plus the index of
 * the matching close-paren. Used to feed CTEs and inline subqueries.
 */
function collectProjectedColumns(
  tokens: import("./scope").Token[],
  openIdx: number,
): { columns: string[]; endIdx: number } {
  const cols: string[] = [];
  let depth = 0;
  let i = openIdx;
  let inSelectList = false;
  let lastIdent: string | null = null;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "punct" && t.text === "(") depth++;
    if (t.kind === "punct" && t.text === ")") {
      depth--;
      if (depth === 0) {
        if (lastIdent !== null) cols.push(lastIdent);
        return { columns: cols, endIdx: i };
      }
    }
    if (depth === 1 && t.kind === "keyword" && t.text.toLowerCase() === "select") {
      inSelectList = true;
      i++;
      continue;
    }
    if (depth === 1 && inSelectList && t.kind === "keyword" && t.text.toLowerCase() === "from") {
      if (lastIdent !== null) cols.push(lastIdent);
      lastIdent = null;
      inSelectList = false;
    }
    if (depth === 1 && inSelectList) {
      if (t.kind === "punct" && t.text === ",") {
        if (lastIdent !== null) cols.push(lastIdent);
        lastIdent = null;
      } else if (t.kind === "keyword" && t.text.toLowerCase() === "as") {
        // alias takes precedence — read next ident
        let j = i + 1;
        while (j < tokens.length && (tokens[j].kind === "ws" || tokens[j].kind === "comment")) j++;
        const aliasTok = tokens[j];
        if (aliasTok && (aliasTok.kind === "ident" || aliasTok.kind === "qident")) {
          lastIdent = aliasTok.kind === "qident" ? aliasTok.text.slice(1, -1) : aliasTok.text;
          i = j;
        }
      } else if (t.kind === "ident" || t.kind === "qident") {
        // Track the last bare identifier as the implicit projected name (e.g. `id`,
        // `users.email` → `email`). For `func(args)` calls we let the caller treat
        // the *last* ident inside the call as the projection name; this is a
        // best-effort heuristic.
        lastIdent = t.kind === "qident" ? t.text.slice(1, -1) : t.text;
      }
    }
    i++;
  }
  return { columns: cols, endIdx: i - 1 };
}
