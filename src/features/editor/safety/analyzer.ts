import { type Token, tokenize } from "../autocomplete/scope";

/**
 * — destructive-statement detector.
 *
 * Pure: classifies the LAST top-level statement in `sql`. Reuses the lexer
 * so string literals, line/block comments, and dollar-quoted bodies cannot
 * false-positive (e.g. `SELECT 'DROP TABLE foo'` reads as a SELECT).
 *
 * The S7 KEYWORDS set covers SELECT-class but NOT every DDL noun (TRUNCATE,
 * SCHEMA, DATABASE, FUNCTION, TRIGGER, …). We therefore match leading tokens
 * by lower-cased text regardless of whether the lexer flagged them as
 * `keyword` or fell back to `ident`. The two `kind`s are equivalent for the
 * purposes of statement-shape classification.
 */

export interface StatementAnalysis {
  kind: "safe" | "destructive" | "unknown";
  action?: "drop" | "truncate" | "delete-all" | "update-all";
  target?: string;
  isReadHeavy?: boolean;
}

/**
 * — Easy mode pre-flight advisory checks.
 *
 * Distinct from {@link analyzeStatement} — those flag operations that DELETE
 * or DROP data and must always be confirmed regardless of mode. The
 * advisories below catch *learner mistakes* (no JOIN condition, full-table
 * SELECT) and only surface in Easy mode through `SlowQueryWarningModal`.
 *
 * - `cross-join`    : `FROM a, b` comma-syntax with no WHERE relating
 * them. tableCount = number of comma-separated
 * relations.
 * - `slow-preview`  : `SELECT * FROM <table>` with no WHERE / JOIN /
 * LIMIT. Likely a learner forgetting to bound the
 * result set.
 *
 * `null` = nothing to warn about.
 */
export type EasyAdvisory = { kind: "cross-join"; tableCount: number } | { kind: "slow-preview" };

const DROP_OBJECTS = new Set([
  "table",
  "schema",
  "database",
  "index",
  "view",
  "function",
  "trigger",
  "type",
  "role",
  "publication",
  "subscription",
]);

/** True iff `t` is an ident-or-keyword token whose lower-cased text equals `lower`. */
function tokenIs(t: Token | undefined, lower: string): boolean {
  if (!t) return false;
  if (t.kind !== "keyword" && t.kind !== "ident") return false;
  return t.text.toLowerCase() === lower;
}

/** Extract a usable identifier string from an ident / qident / keyword token. */
function identText(t: Token | undefined): string | null {
  if (!t) return null;
  if (t.kind === "ident") return t.text;
  if (t.kind === "qident") return t.text.slice(1, -1).replace(/""/g, '"');
  // Some PG names overlap with our lexer's KEYWORDS set (e.g. `view`, `index`,
  // `local`). When they appear in the *target* slot rather than the syntactic
  // slot, accept them as identifiers too.
  if (t.kind === "keyword") return t.text;
  return null;
}

/** Pure: classify the LAST top-level statement in `sql`. */
export function analyzeStatement(sql: string): StatementAnalysis {
  const tokens = tokenize(sql).filter(
    (t) => t.kind !== "ws" && t.kind !== "comment" && t.kind !== "eof",
  );
  if (tokens.length === 0) return { kind: "safe", isReadHeavy: true };

  // Find boundary of last top-level statement: walk backwards, last `;` outside parens.
  // Strip any trailing top-level semicolons first so `DELETE FROM foo;` is treated
  // as a single statement rather than a final empty one.
  let endIdx = tokens.length;
  let depth0 = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === "punct" && t.text === ")") depth0++;
    else if (t.kind === "punct" && t.text === "(") depth0--;
    else if (t.kind === "punct" && t.text === ";" && depth0 === 0) {
      endIdx = i;
      continue;
    }
    break;
  }
  let depth = 0;
  let startIdx = 0;
  for (let i = endIdx - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === "punct" && t.text === ")") depth++;
    if (t.kind === "punct" && t.text === "(") depth--;
    if (t.kind === "punct" && t.text === ";" && depth === 0) {
      startIdx = i + 1;
      break;
    }
  }
  const stmt = tokens
    .slice(startIdx, endIdx)
    .filter((t) => !(t.kind === "punct" && t.text === ";"));
  if (stmt.length === 0) return { kind: "safe", isReadHeavy: true };

  // DROP [MATERIALIZED] <object> [IF EXISTS] <name>
  if (tokenIs(stmt[0], "drop")) {
    let i = 1;
    if (tokenIs(stmt[i], "materialized")) i++;
    const objTok = stmt[i];
    const obj =
      objTok && (objTok.kind === "keyword" || objTok.kind === "ident")
        ? objTok.text.toLowerCase()
        : null;
    if (!obj || !DROP_OBJECTS.has(obj)) return { kind: "unknown" };
    i++;
    if (tokenIs(stmt[i], "if")) i++;
    if (tokenIs(stmt[i], "exists")) i++;
    const target = identText(stmt[i]);
    if (!target) return { kind: "unknown" };
    return { kind: "destructive", action: "drop", target };
  }

  // TRUNCATE [TABLE] <name> [RESTART …]
  if (tokenIs(stmt[0], "truncate")) {
    let i = 1;
    if (tokenIs(stmt[i], "table")) i++;
    const target = identText(stmt[i]);
    if (!target) return { kind: "unknown" };
    return { kind: "destructive", action: "truncate", target };
  }

  // DELETE FROM <name> [WHERE …]
  if (tokenIs(stmt[0], "delete") && tokenIs(stmt[1], "from")) {
    const hasWhere = stmt.some((t) => tokenIs(t, "where"));
    if (!hasWhere) {
      return { kind: "destructive", action: "delete-all", target: "delete-all" };
    }
    return { kind: "safe" };
  }

  // UPDATE <name> SET … [WHERE …]
  if (tokenIs(stmt[0], "update")) {
    const hasWhere = stmt.some((t) => tokenIs(t, "where"));
    if (!hasWhere) {
      return { kind: "destructive", action: "update-all", target: "update-all" };
    }
    return { kind: "safe" };
  }

  // SELECT / WITH … SELECT — read-heavy
  if (tokenIs(stmt[0], "select") || tokenIs(stmt[0], "with")) {
    return { kind: "safe", isReadHeavy: true };
  }

  // INSERT / CREATE / ALTER / GRANT / SET / etc. — safe (creation/admin)
  if (
    tokenIs(stmt[0], "insert") ||
    tokenIs(stmt[0], "create") ||
    tokenIs(stmt[0], "alter") ||
    tokenIs(stmt[0], "grant") ||
    tokenIs(stmt[0], "revoke") ||
    tokenIs(stmt[0], "set") ||
    tokenIs(stmt[0], "comment")
  ) {
    return { kind: "safe" };
  }

  return { kind: "unknown" };
}

/**
 * — extract the LAST top-level statement's tokens. Mirrors the
 * statement-boundary logic inside `analyzeStatement` (see comments there)
 * but exported separately so the Easy advisory checks can reuse it without
 * round-tripping through `analyzeStatement`'s discriminator.
 */
function lastStatementTokens(sql: string): Token[] {
  const tokens = tokenize(sql).filter(
    (t) => t.kind !== "ws" && t.kind !== "comment" && t.kind !== "eof",
  );
  if (tokens.length === 0) return [];

  let endIdx = tokens.length;
  let depth0 = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === "punct" && t.text === ")") depth0++;
    else if (t.kind === "punct" && t.text === "(") depth0--;
    else if (t.kind === "punct" && t.text === ";" && depth0 === 0) {
      endIdx = i;
      continue;
    }
    break;
  }
  let depth = 0;
  let startIdx = 0;
  for (let i = endIdx - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === "punct" && t.text === ")") depth++;
    if (t.kind === "punct" && t.text === "(") depth--;
    if (t.kind === "punct" && t.text === ";" && depth === 0) {
      startIdx = i + 1;
      break;
    }
  }
  return tokens.slice(startIdx, endIdx).filter((t) => !(t.kind === "punct" && t.text === ";"));
}

/**
 * — true iff the token at depth 0 is a top-level keyword that
 * terminates the FROM list (WHERE, GROUP, HAVING, ORDER, LIMIT, OFFSET,
 * UNION, EXCEPT, INTERSECT, RETURNING) or a JOIN keyword that means the
 * comma list is over.
 */
const FROM_TERMINATORS = new Set([
  "where",
  "group",
  "having",
  "order",
  "limit",
  "offset",
  "union",
  "except",
  "intersect",
  "returning",
  "for",
  "fetch",
  "window",
]);

const JOIN_KEYWORDS = new Set([
  "join",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "natural",
  "lateral",
]);

/**
 * — Easy-mode advisory check. Returns the first applicable
 * advisory or `null` when nothing to warn about.
 *
 * Order of precedence:
 * 1. `cross-join`   — `FROM a, b` comma list at depth 0 with no WHERE
 * at all. (`a CROSS JOIN b` in modern syntax is the
 * user's explicit intent — no warning.)
 * 2. `slow-preview` — `SELECT * FROM <single-table>` with no WHERE,
 * no LIMIT, and no JOIN of any flavor.
 */
export function analyzeForEasyAdvisory(sql: string): EasyAdvisory | null {
  const stmt = lastStatementTokens(sql);
  if (stmt.length === 0) return null;

  // Only SELECT statements are subject to Easy advisories.
  if (!tokenIs(stmt[0], "select")) return null;

  // Walk past projection until we find a top-level FROM at depth 0.
  let i = 1;
  let depth = 0;
  let fromStart = -1;
  for (; i < stmt.length; i++) {
    const t = stmt[i];
    if (t.kind === "punct" && t.text === "(") depth++;
    else if (t.kind === "punct" && t.text === ")") depth--;
    else if (depth === 0 && tokenIs(t, "from")) {
      fromStart = i + 1;
      break;
    }
  }
  if (fromStart < 0) return null;

  // Scan the FROM list at depth 0. Track:
  // - tableCount   : number of comma-separated relations
  // - hasJoin      : whether any JOIN keyword appeared (CROSS / INNER / ...)
  // - hasWhere     : whether a top-level WHERE appears later
  // - hasLimit     : whether a top-level LIMIT appears later
  // - hasGroupOrAgg: a SELECT * FROM ... GROUP BY ... is already explicit
  let tableCount = 1;
  let hasJoin = false;
  let hasWhere = false;
  let hasLimit = false;
  let endOfFromList = stmt.length;

  depth = 0;
  for (let j = fromStart; j < stmt.length; j++) {
    const t = stmt[j];
    if (t.kind === "punct" && t.text === "(") {
      depth++;
      continue;
    }
    if (t.kind === "punct" && t.text === ")") {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (t.kind === "punct" && t.text === ",") {
      tableCount++;
      continue;
    }
    if ((t.kind === "keyword" || t.kind === "ident") && JOIN_KEYWORDS.has(t.text.toLowerCase())) {
      hasJoin = true;
      // Don't break — there might still be a WHERE further along we want
      // to see, and JOIN keywords may stack (LEFT OUTER JOIN, …).
      continue;
    }
    if (
      (t.kind === "keyword" || t.kind === "ident") &&
      FROM_TERMINATORS.has(t.text.toLowerCase())
    ) {
      endOfFromList = j;
      break;
    }
  }

  // Scan post-FROM tail for WHERE / LIMIT at depth 0.
  depth = 0;
  for (let j = endOfFromList; j < stmt.length; j++) {
    const t = stmt[j];
    if (t.kind === "punct" && t.text === "(") {
      depth++;
      continue;
    }
    if (t.kind === "punct" && t.text === ")") {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (tokenIs(t, "where")) hasWhere = true;
    if (tokenIs(t, "limit")) hasLimit = true;
  }

  // 1. Cross-join detection — comma list with NO WHERE clause.
  if (tableCount > 1 && !hasJoin && !hasWhere) {
    return { kind: "cross-join", tableCount };
  }

  // 2. Slow-preview detection — `SELECT * FROM t` (single table, no
  // WHERE / LIMIT / JOIN). We require the projection to be exactly `*`
  // so a column list (`SELECT id FROM t`) doesn't trigger.
  const projection = stmt.slice(1, fromStart - 1);
  const isStarProjection =
    projection.length === 1 && projection[0].kind === "operator" && projection[0].text === "*";
  if (isStarProjection && tableCount === 1 && !hasJoin && !hasWhere && !hasLimit) {
    return { kind: "slow-preview" };
  }

  return null;
}
