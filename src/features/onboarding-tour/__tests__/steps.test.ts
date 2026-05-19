/**
 * — acceptance contract for the 8-step tour spec.
 */

import { describe, expect, it } from "vitest";
import { TOUR_STEPS } from "../steps";

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const MAX_BODY_CHARS = 250;

describe("TOUR_STEPS", () => {
  it("has exactly 8 steps in canonical order", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      "welcome",
      "connection-list",
      "schema-tree",
      "editor",
      "result-grid",
      "bidi-panel",
      "settings",
      "help",
    ]);
  });

  it("ids are unique", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TOUR_STEPS)("id '$id' is slug-like", (step) => {
    expect(step.id).toMatch(SLUG_RE);
  });

  it.each(TOUR_STEPS)(    "step '$id' has both EN and RU body, non-empty and within length budget",
    (step) => {
      expect(typeof step.body.en).toBe("string");
      expect(typeof step.body.ru).toBe("string");
      expect(step.body.en.trim().length).toBeGreaterThan(0);
      expect(step.body.ru.trim().length).toBeGreaterThan(0);
      expect(step.body.en.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
      expect(step.body.ru.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    },
);

  it.each(TOUR_STEPS)("step '$id' has a non-empty target selector", (step) => {
    expect(typeof step.target).toBe("string");
    expect(step.target.trim().length).toBeGreaterThan(0);
  });
});
