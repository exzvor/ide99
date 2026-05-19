// — (knn-projection): unit tests for vector-column
// detection from query column metadata.
import { describe, expect, it } from "vitest";
import { detectVectorColumns } from "../pgvectorDetect";

describe("detectVectorColumns", () => {
  it("returns no entries when no vector columns are present", () => {
    const out = detectVectorColumns([
      { name: "id", typeName: "int4" },
      { name: "name", typeName: "text" },
    ]);
    expect(out).toEqual({ vectorColumns: [] });
  });

  it("detects a single vector(768) column with its dimension", () => {
    const out = detectVectorColumns([
      { name: "id", typeName: "int4" },
      { name: "embedding", typeName: "vector(768)" },
    ]);
    expect(out.vectorColumns).toEqual([{ name: "embedding", type: "vector", dim: 768 }]);
  });

  it("detects a mix of vector / halfvec / sparsevec (no-dim) preserving order", () => {
    const out = detectVectorColumns([
      { name: "v", typeName: "vector(3)" },
      { name: "label", typeName: "text" },
      { name: "h", typeName: "halfvec(384)" },
      { name: "s", typeName: "sparsevec" },
    ]);
    expect(out.vectorColumns).toEqual([
      { name: "v", type: "vector", dim: 3 },
      { name: "h", type: "halfvec", dim: 384 },
      { name: "s", type: "sparsevec", dim: null },
    ]);
  });
});
