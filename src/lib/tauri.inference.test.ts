import { describe, expect, it } from "vitest";

import {
  inferenceResponseSchema,
  inferredSchemaSchema,
  pathSegmentSchema,
  probableTypeSchema,
} from "./tauri";

describe("S16 inference zod schemas", () => {
  describe("pathSegmentSchema", () => {
    it("accepts a key segment", () => {
      expect(pathSegmentSchema.parse({ key: "foo" })).toEqual({ key: "foo" });
    });

    it("accepts arraywildcard literal", () => {
      expect(pathSegmentSchema.parse("arraywildcard")).toBe("arraywildcard");
    });

    it("rejects unknown shapes", () => {
      expect(() => pathSegmentSchema.parse({ foo: "bar" })).toThrow();
      expect(() => pathSegmentSchema.parse("wildcard")).toThrow();
    });
  });

  describe("probableTypeSchema", () => {
    it("parses primitive", () => {
      const v = probableTypeSchema.parse({ kind: "primitive", value: "string" });
      expect(v).toEqual({ kind: "primitive", value: "string" });
    });

    it("parses enum", () => {
      const v = probableTypeSchema.parse({ kind: "enum", values: ["a", "b"] });
      expect(v).toEqual({ kind: "enum", values: ["a", "b"] });
    });

    it("parses object", () => {
      expect(probableTypeSchema.parse({ kind: "object" })).toEqual({ kind: "object" });
    });

    it("parses recursive array", () => {
      const v = probableTypeSchema.parse({
        kind: "array",
        element: { kind: "primitive", value: "number" },
      });
      expect(v).toEqual({
        kind: "array",
        element: { kind: "primitive", value: "number" },
      });
    });

    it("parses union", () => {
      const v = probableTypeSchema.parse({
        kind: "union",
        variants: [
          { kind: "primitive", value: "string" },
          { kind: "primitive", value: "number" },
        ],
      });
      expect(Array.isArray((v as any).variants)).toBe(true);
    });

    it("rejects unknown discriminator", () => {
      expect(() => probableTypeSchema.parse({ kind: "frobnicated" })).toThrow();
    });
  });

  describe("inferredSchemaSchema", () => {
    it("parses an empty schema", () => {
      const s = inferredSchemaSchema.parse({
        nodes: [],
        sampleCount: 0,
        generatedAt: 0,
      });
      expect(s.nodes).toEqual([]);
    });

    it("parses a schema with nodes including arraywildcard segments", () => {
      const s = inferredSchemaSchema.parse({
        nodes: [
          {
            path: [{ key: "items" }, "arraywildcard", { key: "price" }],
            kind: { kind: "primitive", value: "number" },
            freq: 0.95,
            samples: [10, 20, 30],
          },
        ],
        sampleCount: 100,
        generatedAt: 1714000000000,
      });
      expect(s.nodes[0].path).toEqual([{ key: "items" }, "arraywildcard", { key: "price" }]);
    });
  });

  describe("inferenceResponseSchema", () => {
    it("parses ready response", () => {
      const r = inferenceResponseSchema.parse({
        status: "ready",
        schema: { nodes: [], sampleCount: 0, generatedAt: 0 },
      });
      expect(r.status).toBe("ready");
    });

    it("parses stale response", () => {
      const r = inferenceResponseSchema.parse({
        status: "stale",
        schema: { nodes: [], sampleCount: 0, generatedAt: 0 },
      });
      expect(r.status).toBe("stale");
    });

    it("parses pending response", () => {
      const r = inferenceResponseSchema.parse({ status: "pending" });
      expect(r.status).toBe("pending");
    });

    it("rejects unknown status", () => {
      expect(() => inferenceResponseSchema.parse({ status: "frobnicated" })).toThrow();
    });

    it("rejects ready without schema", () => {
      expect(() => inferenceResponseSchema.parse({ status: "ready" })).toThrow();
    });
  });
});
