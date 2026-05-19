import { describe, expect, test } from "vitest";
import type { ErdSchemaGraph } from "../../lib/tauri";
import { type LaidErdNode, layoutGraph } from "./layout";

function boxesOverlap(a: LaidErdNode, b: LaidErdNode): boolean {
  // Treat touching as non-overlapping (use strict inequality).
  if (a.x + a.width <= b.x) return false;
  if (b.x + b.width <= a.x) return false;
  if (a.y + a.height <= b.y) return false;
  if (b.y + b.height <= a.y) return false;
  return true;
}

function makeColumn(
  name: string,
  ordinal: number,
  overrides: Partial<{
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    nullable: boolean;
    dataType: string;
  }> = {},
) {
  return {
    name,
    dataType: overrides.dataType ?? "text",
    nullable: overrides.nullable ?? true,
    isPrimaryKey: overrides.isPrimaryKey ?? false,
    isForeignKey: overrides.isForeignKey ?? false,
    ordinal,
  };
}

describe("layoutGraph", () => {
  test("empty input returns empty layout without crashing", () => {
    const graph: ErdSchemaGraph = { tables: [], foreignKeys: [], fetchedInMs: 0 };
    const laid = layoutGraph(graph);
    expect(laid.nodes).toEqual([]);
    expect(laid.edges).toEqual([]);
    expect(laid.width).toBe(0);
    expect(laid.height).toBe(0);
    expect(typeof laid.layoutMs).toBe("number");
  });

  test("3-table / 2-FK fixture lays out without overlapping bounding boxes", () => {
    const graph: ErdSchemaGraph = {
      tables: [
        {
          schema: "public",
          name: "users",
          columns: [
            makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "uuid" }),
            makeColumn("email", 2, { nullable: false, dataType: "text" }),
          ],
        },
        {
          schema: "public",
          name: "orders",
          columns: [
            makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "uuid" }),
            makeColumn("user_id", 2, { isForeignKey: true, nullable: false, dataType: "uuid" }),
            makeColumn("total", 3, { nullable: false, dataType: "numeric" }),
          ],
        },
        {
          schema: "public",
          name: "order_items",
          columns: [
            makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "uuid" }),
            makeColumn("order_id", 2, { isForeignKey: true, nullable: false, dataType: "uuid" }),
            makeColumn("sku", 3, { nullable: false, dataType: "text" }),
          ],
        },
      ],
      foreignKeys: [
        {
          name: "orders_user_id_fkey",
          sourceSchema: "public",
          sourceTable: "orders",
          sourceColumns: ["user_id"],
          targetSchema: "public",
          targetTable: "users",
          targetColumns: ["id"],
        },
        {
          name: "order_items_order_id_fkey",
          sourceSchema: "public",
          sourceTable: "order_items",
          sourceColumns: ["order_id"],
          targetSchema: "public",
          targetTable: "orders",
          targetColumns: ["id"],
        },
      ],
      fetchedInMs: 1,
    };
    const laid = layoutGraph(graph);
    expect(laid.nodes).toHaveLength(3);
    expect(laid.edges).toHaveLength(2);
    for (let i = 0; i < laid.nodes.length; i++) {
      for (let j = i + 1; j < laid.nodes.length; j++) {
        expect(boxesOverlap(laid.nodes[i], laid.nodes[j])).toBe(false);
      }
    }
    // Each edge should have a non-empty path string.
    for (const edge of laid.edges) {
      expect(edge.d.length).toBeGreaterThan(0);
      expect(edge.fromNodeId).toBe(`${"public"}.${edge.fromNodeId.split(".")[1]}`);
      expect(edge.toNodeId.startsWith("public.")).toBe(true);
    }
    // Edge ids must be unique and embed the FK name.
    const ids = laid.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(laid.edges.find((e) => e.id.startsWith("orders_user_id_fkey:"))).toBeDefined();
  });

  test("FK referencing a missing target is dropped silently", () => {
    const graph: ErdSchemaGraph = {
      tables: [
        {
          schema: "public",
          name: "orders",
          columns: [makeColumn("id", 1, { isPrimaryKey: true })],
        },
      ],
      foreignKeys: [
        {
          name: "ghost_fk",
          sourceSchema: "public",
          sourceTable: "orders",
          sourceColumns: ["user_id"],
          targetSchema: "public",
          targetTable: "users",
          targetColumns: ["id"],
        },
      ],
      fetchedInMs: 0,
    };
    const laid = layoutGraph(graph);
    expect(laid.nodes).toHaveLength(1);
    expect(laid.edges).toHaveLength(0);
  });

  test("50 nodes / 80 edges synthetic graph lays out under 200ms", () => {
    const tables = Array.from({ length: 50 }, (_, i) => ({
      schema: "public",
      name: `t_${i}`,
      columns: [
        makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "bigint" }),
        makeColumn("name", 2, { nullable: false, dataType: "text" }),
        makeColumn("ref_id", 3, { isForeignKey: true, nullable: true, dataType: "bigint" }),
      ],
    }));
    // 80 edges spanning the table list, each a unique pair.
    const fks = Array.from({ length: 80 }, (_, k) => {
      const src = (k * 3) % 50;
      const dst = (k * 7 + 1) % 50;
      const dstSafe = src === dst ? (dst + 1) % 50 : dst;
      return {
        name: `fk_${k}`,
        sourceSchema: "public",
        sourceTable: `t_${src}`,
        sourceColumns: ["ref_id"],
        targetSchema: "public",
        targetTable: `t_${dstSafe}`,
        targetColumns: ["id"],
      };
    });
    const graph: ErdSchemaGraph = { tables, foreignKeys: fks, fetchedInMs: 0 };
    const laid = layoutGraph(graph);
    expect(laid.nodes).toHaveLength(50);
    expect(laid.edges.length).toBeGreaterThan(0);
    expect(laid.layoutMs).toBeLessThan(200);
  });

  test("overrides apply on top of dagre layout", () => {
    const graph: ErdSchemaGraph = {
      tables: [
        {
          schema: "public",
          name: "users",
          columns: [
            makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "bigint" }),
          ],
        },
      ],
      foreignKeys: [],
      fetchedInMs: 0,
    };
    const laid = layoutGraph(graph, {
      overrides: new Map([["public.users", { x: 999, y: 888 }]]),
    });
    const u = laid.nodes.find((n) => n.id === "public.users");
    expect(u?.x).toBe(999);
    expect(u?.y).toBe(888);
  });
});
