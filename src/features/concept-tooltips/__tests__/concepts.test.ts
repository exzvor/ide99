/**
 * — concept tooltips knowledge base consistency.
 *
 * These checks pin the contract the rest of the codebase depends on:
 * `CONCEPTS_BY_ID` lookups must always succeed for the canonical 10 ids,
 * every entry must have non-empty EN+RU text, and ids must be slug-like
 * so they can be safely used as React keys, data-* attributes, and CSS
 * hooks.
 */

import { describe, expect, it } from "vitest";
import { CONCEPTS, CONCEPTS_BY_ID, type ConceptEntry } from "../concepts";

const REQUIRED_IDS = [
  "schema",
  "search_path",
  "transaction",
  "null",
  "index",
  "jsonb",
  "cte",
  "generated_column",
  "foreign_key",
  "vacuum",
] as const;

const SLUG_RE = /^[a-z][a-z0-9_]*$/;

describe("CONCEPTS knowledge base", () => {
  it("ships at least 10 entries", () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(10);
  });

  it("has unique ids", () => {
    const ids = CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(REQUIRED_IDS)("includes the canonical concept %s", (id) => {
    expect(CONCEPTS_BY_ID.has(id)).toBe(true);
  });

  it.each(CONCEPTS)(    "entry %# uses a slug-like id (lowercase + underscores)",
    (entry: ConceptEntry) => {
      expect(entry.id).toMatch(SLUG_RE);
    },
);

  it.each(CONCEPTS)("entry %# has non-empty EN + RU explanation", (entry: ConceptEntry) => {
    expect(entry.explanation.en.trim().length).toBeGreaterThan(0);
    expect(entry.explanation.ru.trim().length).toBeGreaterThan(0);
  });

  it.each(CONCEPTS)(    "entry %# either omits `example` or supplies non-empty EN + RU",
    (entry: ConceptEntry) => {
      if (entry.example !== undefined) {
        expect(entry.example.en.trim().length).toBeGreaterThan(0);
        expect(entry.example.ru.trim().length).toBeGreaterThan(0);
      }
    },
);

  it.each(CONCEPTS)("entry %# has at least one matcher regex", (entry: ConceptEntry) => {
    expect(entry.matchers.length).toBeGreaterThan(0);
    for (const re of entry.matchers) {
      expect(re).toBeInstanceOf(RegExp);
    }
  });

  it("CONCEPTS_BY_ID lookup matches the source array length", () => {
    expect(CONCEPTS_BY_ID.size).toBe(CONCEPTS.length);
  });
});
