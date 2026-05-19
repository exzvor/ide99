// src/features/erd/edit/normalizeSql.ts
//
// Whitespace-collapsing equality helper used by both DDL and SELECT
// bidirectional pipelines to detect "is the regenerated text effectively
// equal to what the user has in the editor". This is what breaks the
// forward → reverse → forward cycle without resorting to origin tags.
//
// Not a semantic normalizer — just enough to ignore whitespace + trivial
// punctuation spacing variation.

export function normalizeSql(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([,;()])\s*/g, "$1");
}
