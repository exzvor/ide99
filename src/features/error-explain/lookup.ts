/**
 * — error→plain-English lookup engine.
 *
 * Lookup priority (first match wins):
 * 1. Exact SQLSTATE match (e.g. "23505")
 * 2. Pattern regex match against the message (case-insensitive)
 * 3. Class-prefix match (e.g. "23" for any 23xxx code)
 * 4. `null` — caller falls back to the "Ask your AI agent" block.
 */

import { ERROR_BY_CODE, ERROR_CLASS_BY_PREFIX, ERROR_ENTRIES } from "./mapping";

export type Locale = "en" | "ru";

export interface ExplanationResult {
  /** True when we matched an exact SQLSTATE entry. */
  exact: boolean;
  /** True when we matched a class-prefix fallback. */
  classFallback: boolean;
  /** EN+RU explanation. */
  explanation: { en: string; ru: string };
  /** Optional fix tip. */
  suggestedFix?: { en: string; ru: string };
  /** The matched SQLSTATE (echoed back; useful for the "context for agent" block). */
  matchedCode?: string;
}

export interface LookupInput {
  /** Five-character SQLSTATE if backend supplied it (preferred). */
  sqlstate?: string | null;
  /** Raw error message text from PG (always required as a fallback channel). */
  message: string;
}

/** Resolve an error to a localized explanation. Returns `null` when nothing
 * matches — caller should render the AskAgentBlock. */
export function explainError(input: LookupInput): ExplanationResult | null {
  const { sqlstate, message } = input;

  // 1. Exact SQLSTATE.
  if (sqlstate) {
    const direct = ERROR_BY_CODE.get(sqlstate);
    if (direct) {
      return {
        exact: true,
        classFallback: false,
        explanation: { en: direct.en, ru: direct.ru },
        suggestedFix: direct.suggestedFix,
        matchedCode: direct.code,
      };
    }
  }

  // 2. Pattern regex against the message — runs over every entry that has one.
  for (const entry of ERROR_ENTRIES) {
    if (entry.pattern?.test(message)) {
      return {
        exact: true,
        classFallback: false,
        explanation: { en: entry.en, ru: entry.ru },
        suggestedFix: entry.suggestedFix,
        matchedCode: entry.code,
      };
    }
  }

  // 3. Class fallback: 23xxx → "integrity constraint violation".
  if (sqlstate && sqlstate.length >= 2) {
    const klass = ERROR_CLASS_BY_PREFIX.get(sqlstate.slice(0, 2));
    if (klass) {
      return {
        exact: false,
        classFallback: true,
        explanation: { en: klass.en, ru: klass.ru },
        matchedCode: sqlstate,
      };
    }
  }

  return null;
}

/** Pick the locale-specific text from a `{en, ru}` pair. Tolerates other
 * locales by falling back to EN. */
export function pickLocale<T>(pair: { en: T; ru: T }, locale: string): T {
  return locale.startsWith("ru") ? pair.ru : pair.en;
}

/** Build the clipboard-friendly context block that the user pastes into
 * their MCP-connected AI agent. Order: errcode → message → SQL fragment. */
export function buildAgentContext(input: {
  sqlstate?: string | null;
  message: string;
  sql?: string | null;
  /** Hard cap for the trailing SQL excerpt (default 800 chars). */
  sqlMaxChars?: number;
}): string {
  const parts: string[] = [];
  if (input.sqlstate) parts.push(`SQLSTATE: ${input.sqlstate}`);
  parts.push(`Message: ${input.message.trim()}`);
  if (input.sql) {
    const cap = input.sqlMaxChars ?? 800;
    const sql = input.sql.trim();
    const truncated = sql.length > cap ? `${sql.slice(0, cap)}\n…(truncated)` : sql;
    parts.push(`SQL:\n${truncated}`);
  }
  return parts.join("\n\n");
}
