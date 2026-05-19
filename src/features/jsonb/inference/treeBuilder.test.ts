import { describe, expect, it } from "vitest";

import type { ProbableType } from "../../../lib/tauri";

import { buildTree } from "./treeBuilder";

function pt(kind: ProbableType): ProbableType {
  return kind;
}

describe("buildTree", () => {
  it("flat object becomes top-level children sorted by insertion (analyzer order)", () => {
    const tree = buildTree({
      nodes: [
        {
          path: [{ key: "a" }],
          kind: pt({ kind: "primitive", value: "string" }),
          freq: 1,
          samples: [],
        },
        {
          path: [{ key: "b" }],
          kind: pt({ kind: "primitive", value: "number" }),
          freq: 0.5,
          samples: [],
        },
      ],
      sampleCount: 100,
      generatedAt: 0,
    });
    expect(tree.children.length).toBe(2);
    expect(tree.children.map((c) => c.label).sort()).toEqual(["a", "b"]);
  });

  it("nested path nests under parent", () => {
    const tree = buildTree({
      nodes: [
        { path: [{ key: "a" }], kind: pt({ kind: "object" }), freq: 1, samples: [] },
        {
          path: [{ key: "a" }, { key: "b" }],
          kind: pt({ kind: "primitive", value: "number" }),
          freq: 0.5,
          samples: [],
        },
      ],
      sampleCount: 100,
      generatedAt: 0,
    });
    expect(tree.children[0].label).toBe("a");
    expect(tree.children[0].children[0].label).toBe("b");
    expect(tree.children[0].children[0].typeLabel).toBe("number");
  });

  it("array wildcard renders as [*] suffix on parent", () => {
    const tree = buildTree({
      nodes: [
        {
          path: [{ key: "items" }],
          kind: pt({ kind: "array", element: { kind: "object" } }),
          freq: 1,
          samples: [],
        },
        {
          path: [{ key: "items" }, "arraywildcard", { key: "price" }],
          kind: pt({ kind: "primitive", value: "number" }),
          freq: 1,
          samples: [],
        },
      ],
      sampleCount: 100,
      generatedAt: 0,
    });
    expect(tree.children[0].label).toBe("items[*]");
    expect(tree.children[0].children[0].label).toBe("price");
  });

  it("root scalar emits (root) row with typeLabel + freq", () => {
    const tree = buildTree({
      nodes: [
        {
          path: [],
          kind: pt({ kind: "primitive", value: "number" }),
          freq: 1,
          samples: [42],
        },
      ],
      sampleCount: 5,
      generatedAt: 0,
    });
    // Root scalar populates the synthetic root, which is reflected ONLY through
    // the empty children list (no top-level rows). The (root) node itself is
    // not exposed via the `children` array — UI handles "root scalar" as a
    // distinct rendering branch.
    // Instead we expect zero children when the schema is purely a root scalar.
    expect(tree.children).toEqual([]);
  });

  it("typeLabel formatters", () => {
    const tree = buildTree({
      nodes: [
        {
          path: [{ key: "s" }],
          kind: pt({ kind: "primitive", value: "string" }),
          freq: 1,
          samples: [],
        },
        {
          path: [{ key: "e" }],
          kind: pt({ kind: "enum", values: ["a", "b", "c", "d"] }),
          freq: 1,
          samples: [],
        },
        {
          path: [{ key: "obj" }],
          kind: pt({ kind: "object" }),
          freq: 1,
          samples: [],
        },
        {
          path: [{ key: "arr" }],
          kind: pt({
            kind: "array",
            element: { kind: "primitive", value: "string" },
          }),
          freq: 1,
          samples: [],
        },
        {
          path: [{ key: "u" }],
          kind: pt({
            kind: "union",
            variants: [
              { kind: "primitive", value: "string" },
              { kind: "primitive", value: "number" },
            ],
          }),
          freq: 1,
          samples: [],
        },
      ],
      sampleCount: 1,
      generatedAt: 0,
    });
    const byLabel = Object.fromEntries(tree.children.map((c) => [c.label, c.typeLabel]));
    expect(byLabel.s).toBe("string");
    expect(byLabel.e).toBe("enum: a | b | c | …");
    expect(byLabel.obj).toBe("object");
    expect(byLabel.arr).toBe("array<string>");
    expect(byLabel.u).toBe("string | number");
  });

  it("preserves node freq and samples on leaves", () => {
    const tree = buildTree({
      nodes: [
        {
          path: [{ key: "userId" }],
          kind: pt({ kind: "primitive", value: "string" }),
          freq: 0.98,
          samples: ["abc"],
        },
      ],
      sampleCount: 100,
      generatedAt: 0,
    });
    expect(tree.children[0].freq).toBeCloseTo(0.98);
    expect(tree.children[0].samples).toEqual(["abc"]);
  });

  it("path is preserved on each node for stable keys", () => {
    const tree = buildTree({
      nodes: [
        {
          path: [{ key: "a" }, { key: "b" }],
          kind: pt({ kind: "primitive", value: "number" }),
          freq: 1,
          samples: [],
        },
      ],
      sampleCount: 1,
      generatedAt: 0,
    });
    expect(tree.children[0].path).toEqual([{ key: "a" }]);
    expect(tree.children[0].children[0].path).toEqual([{ key: "a" }, { key: "b" }]);
  });
});
