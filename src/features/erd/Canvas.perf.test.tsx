import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ErdSchemaGraph } from "../../lib/tauri";
import { Canvas } from "./Canvas";
import { layoutGraph } from "./layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        const trailer = Object.entries(opts)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",");
        return `${key} ${trailer}`;
      }
      return key;
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

/**
 * Combined layout-and-render budget.
 *
 * Acceptance criterion: "Generate ERD on 50 tables → auto-layout without
 * overlapping in under 2s". The backend has its own ~500 ms budget
 * (integration test); this test asserts the FE half — `layoutGraph` plus the
 * Canvas mount — completes well under 1.5 s for 50 tables / 80 FKs in jsdom.
 *
 * jsdom is slower than a real browser for DOM operations; if this passes
 * here, real-browser performance is bounded above by it.
 */
describe("Canvas — 50 tables perf budget", () => {
  test("layoutGraph + render completes under 1.5 s for 50 tables / 80 FKs", () => {
    const tables = Array.from({ length: 50 }, (_, i) => ({
      schema: i % 3 === 0 ? "public" : i % 3 === 1 ? "app" : "audit",
      name: `t_${i}`,
      columns: Array.from({ length: 6 }, (_, j) => ({
        name: j === 0 ? "id" : j === 1 ? "ref_id" : `col_${j}`,
        dataType: j === 0 ? "bigint" : "text",
        nullable: j !== 0,
        isPrimaryKey: j === 0,
        isForeignKey: j === 1,
        ordinal: j + 1,
      })),
    }));
    const fks = Array.from({ length: 80 }, (_, k) => {
      const src = (k * 3) % 50;
      const dst = (k * 7 + 1) % 50;
      const dstSafe = src === dst ? (dst + 1) % 50 : dst;
      return {
        name: `fk_${k}`,
        sourceSchema: tables[src].schema,
        sourceTable: tables[src].name,
        sourceColumns: ["ref_id"],
        targetSchema: tables[dstSafe].schema,
        targetTable: tables[dstSafe].name,
        targetColumns: ["id"],
      };
    });
    const graph: ErdSchemaGraph = { tables, foreignKeys: fks, fetchedInMs: 0 };

    const t0 = performance.now();
    const laid = layoutGraph(graph);
    const { container, unmount } = render(      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
      />,
);
    const elapsed = performance.now() - t0;

    expect(laid.nodes).toHaveLength(50);
    expect(laid.edges.length).toBeGreaterThan(0);
    // Renders one card per node + at least one edge.
    expect(container.querySelectorAll('[data-testid="erd-table-card"]').length).toBe(50);
    expect(container.querySelectorAll('[data-testid="erd-fk-edge"]').length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1500);
    unmount();
  });
});
