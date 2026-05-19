import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutocompleteSnapshot, InferredSchema } from "../../../lib/tauri";
import { rankAndBuild } from "./provider";
import { BUILTIN_SNIPPETS } from "./snippets";
import type { Scope } from "./types";

// ---------------------------------------------------------------------------
// Mock the jsonb inference store so provider tests stay Tauri-free.
// The mock is replaced per-test via the mutable `_inferenceState` object.
// ---------------------------------------------------------------------------

type MockInferenceState = {
  getCached: (connId: string, fqn: object) => InferredSchema | null;
  request: (connId: string, fqn: object, onReady?: () => void) => void;
};

const _inferenceState: MockInferenceState = {
  getCached: () => null,
  request: () => {},
};

vi.mock("../../jsonb/inference", () => ({
  useJsonbInference: {
    getState: () => _inferenceState,
  },
}));

beforeEach(() => {
  // Reset inference mock to safe defaults between tests.
  _inferenceState.getCached = () => null;
  _inferenceState.request = () => {};
});

const snapshot: AutocompleteSnapshot = {
  connId: "c1",
  searchPath: ["public", "app"],
  relations: [
    {
      schema: "public",
      name: "users",
      kind: "table",
      columns: [
        { name: "id", dataType: "bigint", nullable: false, isJsonb: false },
        { name: "email", dataType: "text", nullable: true, isJsonb: false },
      ],
    },
    {
      schema: "app",
      name: "orders",
      kind: "table",
      columns: [
        { name: "id", dataType: "bigint", nullable: false, isJsonb: false },
        { name: "total", dataType: "numeric", nullable: false, isJsonb: false },
      ],
    },
  ],
  loadedAt: 0,
};

const baseScope = (over: Partial<Scope>): Scope => ({
  ctes: [],
  fromAliases: [],
  clause: "unknown",
  trigger: { kind: "ctrl-space" },
  prefix: "",
  ...over,
});

describe("rankAndBuild", () => {
  it("alias-dot returns columns of the resolved relation only", () => {
    const scope = baseScope({
      clause: "where",
      trigger: { kind: "alias-dot", alias: "u" },
      fromAliases: [{ alias: "u", relation: { schema: "public", name: "users" } }],
    });
    const items = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS).suggestions;
    const labels = items.map((i) => i.label);
    expect(labels).toContain("id");
    expect(labels).toContain("email");
    expect(labels).not.toContain("total");
  });

  it("alias-dot for a CTE alias returns CTE columns", () => {
    const scope = baseScope({
      clause: "select-list",
      trigger: { kind: "alias-dot", alias: "x" },
      ctes: [{ name: "x", columns: ["a", "b"] }],
    });
    const items = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS).suggestions;
    expect(items.map((i) => i.label).sort()).toEqual(["a", "b"]);
  });

  it("alias-dot for subquery alias returns its columns", () => {
    const scope = baseScope({
      clause: "where",
      trigger: { kind: "alias-dot", alias: "sub" },
      fromAliases: [{ alias: "sub", columns: ["id", "name"] }],
    });
    const items = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS).suggestions;
    expect(items.map((i) => i.label).sort()).toEqual(["id", "name"]);
  });

  it("FROM clause lists tables from search_path schemas", () => {
    const scope = baseScope({ clause: "from" });
    const items = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS).suggestions;
    const labels = items.map((i) => String(i.label));
    expect(labels.some((l) => l.includes("users"))).toBe(true);
    expect(labels.some((l) => l.includes("orders"))).toBe(true);
  });

  it("WHERE clause lists FROM-alias columns", () => {
    const scope = baseScope({
      clause: "where",
      fromAliases: [{ alias: "u", relation: { schema: "public", name: "users" } }],
    });
    const items = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS).suggestions;
    expect(items.some((i) => i.label === "id")).toBe(true);
    expect(items.some((i) => i.label === "email")).toBe(true);
  });

  it("snippets visible in clause unknown when scope is unknown", () => {
    const scope = baseScope({ clause: "unknown" });
    const items = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS).suggestions;
    expect(items.some((i) => i.label === "SELECT … FROM … WHERE")).toBe(true);
  });

  it("ranks scope CTE columns higher than search_path table columns", () => {
    const scope = baseScope({
      clause: "select-list",
      ctes: [{ name: "x", columns: ["foo"] }],
      fromAliases: [{ alias: "u", relation: { schema: "public", name: "users" } }],
    });
    const items = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS).suggestions;
    const cteIdx = items.findIndex((i) => i.label === "foo");
    const colIdx = items.findIndex((i) => i.label === "id");
    expect(cteIdx).toBeGreaterThanOrEqual(0);
    expect(colIdx).toBeGreaterThanOrEqual(0);
    expect(cteIdx).toBeLessThan(colIdx);
  });

  it("schema-dot via alias-dot when alias matches a schema name lists tables in that schema", () => {
    const scope = baseScope({
      clause: "from",
      trigger: { kind: "alias-dot", alias: "app" },
    });
    const items = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS).suggestions;
    expect(items.some((i) => i.label === "orders")).toBe(true);
    expect(items.some((i) => i.label === "users")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// jsonb-path branch tests
// ---------------------------------------------------------------------------

const jsonbSnapshot: AutocompleteSnapshot = {
  connId: "c1",
  searchPath: ["public"],
  relations: [
    {
      schema: "public",
      name: "events",
      kind: "table",
      columns: [
        { name: "data", dataType: "jsonb", nullable: true, isJsonb: true },
        { name: "name", dataType: "text", nullable: true, isJsonb: false },
      ],
    },
  ],
  loadedAt: 0,
};

const jsonbScope = (over: Partial<Scope>): Scope => ({
  ctes: [],
  fromAliases: [{ alias: "events", relation: { schema: "public", name: "events" } }],
  clause: "select-list",
  trigger: {
    kind: "jsonb-path",
    alias: null,
    column: "data",
    path: [],
    partial: "",
  },
  prefix: "",
  ...over,
});

const fakeSchema: InferredSchema = {
  nodes: [
    {
      path: [{ key: "userId" }],
      kind: { kind: "primitive", value: "string" } as any,
      freq: 0.98,
      samples: ["abc"],
    },
    {
      path: [{ key: "event" }],
      kind: { kind: "enum", values: ["login"] } as any,
      freq: 0.95,
      samples: [],
    },
  ],
  sampleCount: 100,
  generatedAt: 0,
};

describe("rankAndBuild — jsonb-path branch", () => {
  it("returns inferred schema completions when cache is populated", () => {
    _inferenceState.getCached = () => fakeSchema;

    const result = rankAndBuild(jsonbScope({}), jsonbSnapshot, []);
    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain("userId");
    expect(labels).toContain("event");
  });

  it("returns empty incomplete=true and queues request when cache is missing", () => {
    _inferenceState.getCached = () => null;
    let requested = false;
    _inferenceState.request = () => {
      requested = true;
    };

    const result = rankAndBuild(
      jsonbScope({
        trigger: { kind: "jsonb-path", alias: null, column: "data", path: [], partial: "us" },
      }),
      jsonbSnapshot,
      [],
    );
    expect(result.suggestions).toEqual([]);
    expect(result.incomplete).toBe(true);
    expect(requested).toBe(true);
  });

  it("returns no suggestions if column is not jsonb", () => {
    _inferenceState.getCached = () => fakeSchema;

    const result = rankAndBuild(
      jsonbScope({
        trigger: { kind: "jsonb-path", alias: null, column: "name", path: [], partial: "" },
      }),
      jsonbSnapshot,
      [],
    );
    expect(result.suggestions).toEqual([]);
    expect(result.incomplete).toBe(false);
  });

  // fix — search-path fallback when there's no FROM clause.
  it("resolves column via search-path when fromAliases is empty (no FROM)", () => {
    _inferenceState.getCached = () => fakeSchema;

    const noFromScope: Scope = {
      ctes: [],
      fromAliases: [], // no FROM yet
      clause: "select-list",
      trigger: { kind: "jsonb-path", alias: null, column: "data", path: [], partial: "" },
      prefix: "",
    };
    const result = rankAndBuild(noFromScope, jsonbSnapshot, []);
    expect(result.suggestions.map((s) => s.label)).toContain("userId");
  });

  it("search-path fallback bails out when column is ambiguous in same schema", () => {
    _inferenceState.getCached = () => fakeSchema;
    const ambiguousSnapshot: AutocompleteSnapshot = {
      ...jsonbSnapshot,
      relations: [
        {
          schema: "public",
          name: "events",
          kind: "table",
          columns: [{ name: "data", dataType: "jsonb", nullable: true, isJsonb: true }],
        },
        {
          schema: "public",
          name: "audit",
          kind: "table",
          columns: [{ name: "data", dataType: "jsonb", nullable: true, isJsonb: true }],
        },
      ],
    };
    const noFromScope: Scope = {
      ctes: [],
      fromAliases: [],
      clause: "select-list",
      trigger: { kind: "jsonb-path", alias: null, column: "data", path: [], partial: "" },
      prefix: "",
    };
    const result = rankAndBuild(noFromScope, ambiguousSnapshot, []);
    // Two relations in `public` both have `data jsonb` — refuse to guess.
    expect(result.suggestions).toEqual([]);
  });

  it("search-path fallback skipped when an alias was specified", () => {
    _inferenceState.getCached = () => fakeSchema;
    const noFromScope: Scope = {
      ctes: [],
      fromAliases: [],
      clause: "select-list",
      trigger: { kind: "jsonb-path", alias: "e", column: "data", path: [], partial: "" },
      prefix: "",
    };
    const result = rankAndBuild(noFromScope, jsonbSnapshot, []);
    // Aliased trigger requires explicit FROM — fallback only fires for
    // bare column lookups.
    expect(result.suggestions).toEqual([]);
  });
});
