import { describe, expect, it } from "vitest";

import type { InferredSchema, ProbableType } from "../../../lib/tauri";

import { type CompletionPath, buildJsonbCompletions } from "./jsonbCompletions";

function pt(kind: ProbableType): ProbableType {
  return kind;
}

const fixture: InferredSchema = {
  nodes: [
    {
      path: [{ key: "userId" }],
      kind: pt({ kind: "primitive", value: "string" }),
      freq: 0.98,
      samples: ["abc"],
    },
    {
      path: [{ key: "event" }],
      kind: pt({ kind: "enum", values: ["login", "logout"] }),
      freq: 0.95,
      samples: [],
    },
    {
      path: [{ key: "preferences" }],
      kind: pt({ kind: "object" }),
      freq: 0.6,
      samples: [],
    },
    {
      path: [{ key: "preferences" }, { key: "theme" }],
      kind: pt({ kind: "primitive", value: "string" }),
      freq: 0.6,
      samples: [],
    },
    {
      path: [{ key: "items" }],
      kind: pt({ kind: "array", element: { kind: "object" } }),
      freq: 0.3,
      samples: [],
    },
    {
      path: [{ key: "items" }, "arraywildcard", { key: "price" }],
      kind: pt({ kind: "primitive", value: "number" }),
      freq: 1.0,
      samples: [10, 20],
    },
  ],
  sampleCount: 100,
  generatedAt: 0,
};

describe("buildJsonbCompletions", () => {
  it("top-level partial filters by prefix (case-insensitive)", () => {
    const items = buildJsonbCompletions(fixture, [], "U");
    expect(items.map((i) => i.label)).toEqual(["userId"]);
  });

  it("empty partial returns all top-level keys", () => {
    const items = buildJsonbCompletions(fixture, [], "");
    expect(items.map((i) => i.label).sort()).toEqual(["event", "items", "preferences", "userId"]);
  });

  it("nested path returns child keys", () => {
    const items = buildJsonbCompletions(fixture, [{ key: "preferences" }] as CompletionPath, "");
    expect(items.map((i) => i.label)).toEqual(["theme"]);
  });

  it("numeric arrayIndex normalizes to arraywildcard", () => {
    const items = buildJsonbCompletions(
      fixture,
      [{ key: "items" }, { arrayIndex: 0 }] as CompletionPath,
      "",
    );
    expect(items.map((i) => i.label)).toEqual(["price"]);
  });

  it("includes type label and frequency in detail", () => {
    const items = buildJsonbCompletions(fixture, [], "user");
    expect(items[0].detail).toContain("string");
    expect(items[0].detail).toContain("98%");
  });

  it("includes samples in documentation when present", () => {
    const items = buildJsonbCompletions(fixture, [], "user");
    expect(items[0].documentation).toContain("abc");
  });

  it("higher freq nodes get lower (better) tier than lower freq", () => {
    const items = buildJsonbCompletions(fixture, [], "");
    const labels = items.map((i) => i.label);
    // userId (98%) and event (95%) — tier 100; preferences (60%) — tier 100;
    // items (30%) — tier 200. items must come AFTER all 100-tier entries.
    expect(labels.indexOf("items")).toBeGreaterThan(labels.indexOf("userId"));
    expect(labels.indexOf("items")).toBeGreaterThan(labels.indexOf("preferences"));
  });

  it("returns empty list when path doesn't match any node", () => {
    const items = buildJsonbCompletions(fixture, [{ key: "nonexistent" }] as CompletionPath, "");
    expect(items).toEqual([]);
  });

  it("formats enum type label with first-3 values", () => {
    const items = buildJsonbCompletions(fixture, [], "event");
    expect(items[0].detail).toContain("enum");
    expect(items[0].detail).toContain("login");
  });

  it("regression: scope-emitted segments without 'kind' discriminant work", () => {
    // This is the shape scope.ts emits at runtime: { key: string } | { arrayIndex: number }
    const items = buildJsonbCompletions(fixture, [{ key: "preferences" }], "th");
    expect(items.map((i) => i.label)).toEqual(["theme"]);
  });
});
