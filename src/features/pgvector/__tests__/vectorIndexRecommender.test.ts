// — (vector-index): boundary-case unit tests for the
// pure recommender per the Heuristics table in the design spec.
import { describe, expect, it } from "vitest";
import { recommend } from "../vectorIndexRecommender";

describe("vectorIndexRecommender.recommend", () => {
  it("rowCount=9_999, dim=768 → HNSW small (m=16, ef_construction=64)", () => {
    const r = recommend({ rowCount: 9_999, dim: 768 });
    expect(r.method).toBe("hnsw");
    expect(r.params).toEqual({ m: 16, ef_construction: 64 });
    expect(r.rationale).not.toBe("");
    expect(r.rationale).toContain("Small table");
  });

  it("rowCount=10_000, dim=768 → HNSW medium (m=16, ef_construction=128)", () => {
    const r = recommend({ rowCount: 10_000, dim: 768 });
    expect(r.method).toBe("hnsw");
    expect(r.params).toEqual({ m: 16, ef_construction: 128 });
    expect(r.rationale).not.toBe("");
    expect(r.rationale).toContain("Medium table");
  });

  it("rowCount=999_999, dim=768 → HNSW medium", () => {
    const r = recommend({ rowCount: 999_999, dim: 768 });
    expect(r.method).toBe("hnsw");
    expect(r.params).toEqual({ m: 16, ef_construction: 128 });
    expect(r.rationale).toContain("Medium table");
  });

  it("rowCount=1_000_000, dim=768 → IVFFlat with lists=1000", () => {
    const r = recommend({ rowCount: 1_000_000, dim: 768 });
    expect(r.method).toBe("ivfflat");
    expect(r.params).toEqual({ lists: 1000 });
    expect(r.rationale).not.toBe("");
    expect(r.rationale).toContain("Large table");
  });

  it("rowCount=4_000_000, dim=768 → IVFFlat with lists=2000", () => {
    const r = recommend({ rowCount: 4_000_000, dim: 768 });
    expect(r.method).toBe("ivfflat");
    expect(r.params).toEqual({ lists: 2000 });
    expect(r.rationale).toContain("Large table");
  });

  it("rowCount=50, dim=768 → HNSW small (high-rowCount branch never activates)", () => {
    const r = recommend({ rowCount: 50, dim: 768 });
    expect(r.method).toBe("hnsw");
    expect(r.params).toEqual({ m: 16, ef_construction: 64 });
    expect(r.rationale).toContain("Small table");
  });

  it("rowCount=1_500_000, dim=3000 → IVFFlat (dim override) with lists=1200", () => {
    const r = recommend({ rowCount: 1_500_000, dim: 3000 });
    expect(r.method).toBe("ivfflat");
    expect(r.params).toEqual({ lists: 1200 });
    expect(r.rationale).not.toBe("");
    expect(r.rationale).toContain("HNSW");
  });

  it("rowCount=50, dim=3000 → IVFFlat (dim override) with lists=100 floor", () => {
    const r = recommend({ rowCount: 50, dim: 3000 });
    expect(r.method).toBe("ivfflat");
    expect(r.params).toEqual({ lists: 100 });
    expect(r.rationale).toContain("HNSW");
  });

  it("accepts opclass forward-compat parameter without altering recommendation", () => {
    const r = recommend({ rowCount: 500, dim: 384, opclass: "vector_cosine_ops" });
    expect(r.method).toBe("hnsw");
    expect(r.params).toEqual({ m: 16, ef_construction: 64 });
  });
});
