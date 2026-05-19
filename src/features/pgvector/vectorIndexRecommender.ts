// — owner: (vector-index).
//
// Pure recommendation engine — given a table's row count and a vector
// column's dimensionality, pick HNSW vs IVFFlat with sensible default
// tuning parameters and a human-readable rationale. Heuristics mirror the
// design spec; the recommendation is advisory, not enforced.

export type Recommendation = {
  method: "hnsw" | "ivfflat";
  params: Record<string, number>;
  rationale: string;
};

/**
 * Recommended `lists` for IVFFlat: round(sqrt(rowCount) / 100) * 100,
 * floored at 100 — matches the pgvector docs' rule of thumb.
 */
function ivfflatLists(rowCount: number): number {
  const raw = Math.round(Math.sqrt(Math.max(rowCount, 0)) / 100) * 100;
  return Math.max(100, raw);
}

export function recommend(input: {
  rowCount: number;
  dim: number;
  /** Reserved — not yet consumed; accepted for forward compatibility. */
  opclass?: string;
}): Recommendation {
  const { rowCount, dim } = input;

  // Dimension override — HNSW caps at 2000 dims in pgvector, so above
  // that we must fall back to IVFFlat regardless of row count.
  if (dim > 2000) {
    return {
      method: "ivfflat",
      params: { lists: ivfflatLists(rowCount) },
      rationale:
        "HNSW supports up to 2000 dimensions in pgvector — using IVFFlat which has no dimension cap.",
    };
  }

  if (rowCount < 10_000) {
    return {
      method: "hnsw",
      params: { m: 16, ef_construction: 64 },
      rationale:
        "Small table — HNSW is fast to build at this size and gives the best query latency.",
    };
  }

  if (rowCount < 1_000_000) {
    return {
      method: "hnsw",
      params: { m: 16, ef_construction: 128 },
      rationale:
        "Medium table — HNSW with higher ef_construction gives better recall; build time still acceptable.",
    };
  }

  return {
    method: "ivfflat",
    params: { lists: ivfflatLists(rowCount) },
    rationale:
      "Large table — IVFFlat builds faster and uses less memory than HNSW. lists ≈ √rowCount per pgvector docs.",
  };
}
