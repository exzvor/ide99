// src/features/editor/store.queryShape.test.ts
//
// Unit tests for the  queryShape slice on the editor store.
// Mocks the Tauri layer (same pattern as `store.test.ts`) so the store
// imports cleanly under jsdom.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
    queryRunBatch: vi.fn(),
    queryFetchPage: vi.fn(),
    queryCancel: vi.fn(),
    queryCloseCursor: vi.fn(),
  };
});

import type { QueryShape } from "../../lib/parser";
import { useEditor } from "./store";

const TAB = "tab-1";

function flatShape(overrides: Partial<QueryShape> = {}): QueryShape {
  return {
    baseSelect: { schema: null, table: "users", columns: [] },
    filters: [],
    sort: null,
    limit: null,
    unrepresentableTail: null,
    whereSpan: null,
    orderBySpan: null,
    limitSpan: null,
    fromEnd: 19,
    ...overrides,
  };
}

function seedShape(shape: QueryShape) {
  // Use the public action so we exercise the same path as production code.
  useEditor.getState().applyShapeFromAst(TAB, shape, []);
}

beforeEach(() => {
  // Reset the per-tab Maps so tests don't bleed into each other. We only
  // touch the queryShape-slice fields; the rest of the store is unaffected.
  useEditor.setState({
    queryShapes: new Map(),
    shapeWarnings: new Map(),
    lastExecutedShape: new Map(),
  });
});

describe("setFilter", () => {
  it("adds a filter when none exists for the column", () => {
    seedShape(flatShape());
    useEditor.getState().setFilter(TAB, "id", { column: "id", op: "eq", value: 5 });
    const filters = useEditor.getState().queryShapes.get(TAB)?.filters ?? [];
    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual({ column: "id", op: "eq", value: 5 });
  });

  it("replaces the existing filter for the same column", () => {
    seedShape(flatShape({ filters: [{ column: "id", op: "eq", value: 5 }] }));
    useEditor.getState().setFilter(TAB, "id", { column: "id", op: "gt", value: 10 });
    const filters = useEditor.getState().queryShapes.get(TAB)?.filters ?? [];
    expect(filters).toHaveLength(1);
    expect(filters[0]?.op).toBe("gt");
    expect(filters[0]?.value).toBe(10);
  });

  it("removes the filter when called with null", () => {
    seedShape(      flatShape({
        filters: [
          { column: "id", op: "eq", value: 5 },
          { column: "name", op: "like", value: "A%" },
        ],
      }),
);
    useEditor.getState().setFilter(TAB, "id", null);
    const filters = useEditor.getState().queryShapes.get(TAB)?.filters ?? [];
    expect(filters).toHaveLength(1);
    expect(filters[0]?.column).toBe("name");
  });

  it("no-ops when the tab has no shape", () => {
    // Tab not seeded — queryShapes.get(TAB) is undefined.
    useEditor.getState().setFilter(TAB, "id", { column: "id", op: "eq", value: 5 });
    expect(useEditor.getState().queryShapes.get(TAB)).toBeUndefined();
  });

  it("forces filter.column to match the keying name", () => {
    seedShape(flatShape());
    // Caller passes the wrong column inside the filter payload; the action
    // should overwrite it with the slot it's keyed under so the invariant
    // (filter.column === keying column) holds.
    useEditor.getState().setFilter(TAB, "id", { column: "WRONG", op: "eq", value: 1 });
    const filters = useEditor.getState().queryShapes.get(TAB)?.filters ?? [];
    expect(filters[0]?.column).toBe("id");
  });
});

describe("clearFilters", () => {
  it("removes all filters from the tab's shape", () => {
    seedShape(      flatShape({
        filters: [
          { column: "id", op: "eq", value: 5 },
          { column: "name", op: "like", value: "A%" },
        ],
      }),
);
    useEditor.getState().clearFilters(TAB);
    expect(useEditor.getState().queryShapes.get(TAB)?.filters).toHaveLength(0);
  });
});

describe("applyShapeFromAst", () => {
  it("applies a fresh shape and stores warnings", () => {
    const shape = flatShape({ limit: 100 });
    useEditor.getState().applyShapeFromAst(TAB, shape, ["w1"]);
    expect(useEditor.getState().queryShapes.get(TAB)).toEqual(shape);
    expect(useEditor.getState().shapeWarnings.get(TAB)).toEqual(["w1"]);
  });

  it("skip-unrepresentable: replaces shape so the unrepresentable banner can render ()", () => {
    // keeping the OLD shape silently meant ResultGrid kept filter
    // icons active even though the live query had a JOIN. The fix is to
    // replace the shape with the unrepresentable one so:
    // - ResultGrid sees `unrepresentableTail !== null` and disables filters
    // - UnrepresentableBar reads `unrepresentableTail` and renders.
    const original = flatShape({ filters: [{ column: "id", op: "eq", value: 1 }] });
    useEditor.getState().applyShapeFromAst(TAB, original, []);

    const tainted = flatShape({ unrepresentableTail: "non-flat-from" });
    useEditor.getState().applyShapeFromAst(TAB, tainted, ["unrep!"]);

    // Shape is REPLACED with the tainted version, warnings stored.
    expect(useEditor.getState().queryShapes.get(TAB)).toEqual(tainted);
    expect(useEditor.getState().shapeWarnings.get(TAB)).toEqual(["unrep!"]);
  });

  it("noop-equal: leaves Map references untouched when shape is unchanged", () => {
    const shape = flatShape({ limit: 100 });
    useEditor.getState().applyShapeFromAst(TAB, shape, []);
    const beforeRef = useEditor.getState().queryShapes;

    // Re-apply an identical shape — the Map reference should not change
    // because Zustand re-renders are gated on Map identity.
    useEditor.getState().applyShapeFromAst(TAB, flatShape({ limit: 100 }), []);
    expect(useEditor.getState().queryShapes).toBe(beforeRef);
  });
});

describe("markShapeExecuted", () => {
  it("snapshots the current shape into lastExecutedShape", () => {
    const shape = flatShape({ filters: [{ column: "id", op: "eq", value: 7 }] });
    useEditor.getState().applyShapeFromAst(TAB, shape, []);
    useEditor.getState().markShapeExecuted(TAB);
    expect(useEditor.getState().lastExecutedShape.get(TAB)).toEqual(shape);
  });

  it("captures null when the tab has no shape", () => {
    useEditor.getState().markShapeExecuted(TAB);
    // Map.get returns undefined when key is absent OR null when explicitly set.
    expect(useEditor.getState().lastExecutedShape.get(TAB)).toBeNull();
  });

  it("captures a snapshot independent of subsequent edits", () => {
    const shape = flatShape({ filters: [{ column: "id", op: "eq", value: 1 }] });
    useEditor.getState().applyShapeFromAst(TAB, shape, []);
    useEditor.getState().markShapeExecuted(TAB);

    // Mutate after marking — the snapshot must NOT reflect the mutation.
    useEditor.getState().setFilter(TAB, "id", { column: "id", op: "gt", value: 99 });
    expect(useEditor.getState().lastExecutedShape.get(TAB)?.filters[0]?.value).toBe(1);
    expect(useEditor.getState().queryShapes.get(TAB)?.filters[0]?.value).toBe(99);
  });
});

describe("getQueryShape", () => {
  it("returns the stored shape", () => {
    const shape = flatShape({ limit: 50 });
    useEditor.getState().applyShapeFromAst(TAB, shape, []);
    expect(useEditor.getState().getQueryShape(TAB)).toEqual(shape);
  });

  it("returns null when the tab has no shape", () => {
    expect(useEditor.getState().getQueryShape(TAB)).toBeNull();
  });
});
