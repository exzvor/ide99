// — : unit tests for the pure 2D PCA projection.
import { describe, expect, it } from "vitest";
import { pcaProject } from "../pcaProject";

describe("pcaProject", () => {
  it("returns an empty array for empty input", () => {
    expect(pcaProject([])).toEqual([]);
  });

  it("returns a single 2D zero point for a single all-zero vector (centering)", () => {
    const out = pcaProject([Float32Array.from([0, 0, 0])]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(out[0].length).toBe(2);
    expect(out[0][0]).toBe(0);
    expect(out[0][1]).toBe(0);
  });

  it("projects five all-zero vectors to five 2D zeros (no variance)", () => {
    const out = pcaProject(Array.from({ length: 5 }, () => Float32Array.from([0, 0, 0, 0])));
    expect(out).toHaveLength(5);
    for (const p of out) {
      expect(p).toBeInstanceOf(Float32Array);
      expect(p.length).toBe(2);
      expect(p[0]).toBe(0);
      expect(p[1]).toBe(0);
    }
  });

  it("captures the dominant axis on a collinear 4-point input", () => {
    const out = pcaProject([
      Float32Array.from([1, 1, 0]),
      Float32Array.from([2, 2, 0]),
      Float32Array.from([3, 3, 0]),
      Float32Array.from([4, 4, 0]),
    ]);
    expect(out).toHaveLength(4);
    for (const p of out) {
      expect(p.length).toBe(2);
    }
    // Sign of PC1 is conventionally arbitrary; check the structural property
    // that the projections are spread out along the first axis.
    expect(Math.abs(out[3][0] - out[0][0])).toBeGreaterThan(0.1);
    // Second axis carries no variance for points lying on a single line.
    for (const p of out) {
      expect(Math.abs(p[1])).toBeLessThan(1e-3);
    }
  });

  it("handles 1-D input by leaving the second axis at zero", () => {
    const out = pcaProject([
      Float32Array.from([1]),
      Float32Array.from([2]),
      Float32Array.from([3]),
    ]);
    expect(out).toHaveLength(3);
    for (const p of out) {
      expect(p.length).toBe(2);
      expect(p[1]).toBe(0);
    }
    // First axis carries the variance (after centering).
    expect(Math.abs(out[2][0] - out[0][0])).toBeGreaterThan(0.1);
  });
});
