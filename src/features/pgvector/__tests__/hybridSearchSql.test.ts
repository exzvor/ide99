// — : snapshot + invariant tests for the hybrid-search
// SQL builder. The CTE template is documented in the design spec;
// we lock indentation here so the editor-tab text stays stable across runs.
import { describe, expect, it } from "vitest";
import { type HybridSearchInput, buildHybridSearchSql } from "../hybridSearchSql";

const baseInput: HybridSearchInput = {
  qualifiedTable: "public.items",
  pk: "id",
  vectorCol: "embedding",
  vectorPivotExpr: "'[0.1,0.2]'::vector",
  tsCol: "title_ts",
  tsQuery: "hello",
  distanceOp: "<->",
  weights: { vector: 0.5, text: 0.5 },
  rrfK: 60,
  limit: 50,
};

function lastNonEmptyLine(sql: string): string {
  const lines = sql.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== "") return lines[i];
  }
  return "";
}

describe("buildHybridSearchSql", () => {
  it("emits the documented CTE skeleton for the minimal form", () => {
    const sql = buildHybridSearchSql(baseInput);
    expect(sql.startsWith("-- pgvector hybrid search (RRF)\n")).toBe(true);
    expect(lastNonEmptyLine(sql)).toBe("LIMIT 50");
    expect(sql).toMatchInlineSnapshot(`
      "-- pgvector hybrid search (RRF)

      WITH vec_ranked AS (        SELECT id, ROW_NUMBER() OVER (                 ORDER BY embedding <-> '[0.1,0.2]'::vector
) AS rnk
        FROM public.items
        ORDER BY embedding <-> '[0.1,0.2]'::vector
        LIMIT 200
),
      ts_ranked AS (        SELECT id, ROW_NUMBER() OVER (                 ORDER BY ts_rank_cd(title_ts, plainto_tsquery('hello')) DESC
) AS rnk
        FROM public.items
        WHERE title_ts @@ plainto_tsquery('hello')
        LIMIT 200
)
      SELECT t.*,
             (COALESCE(0.5 / (60 + v.rnk)::float, 0)
            + COALESCE(0.5 / (60 + s.rnk)::float, 0)) AS score
      FROM public.items t
      LEFT JOIN vec_ranked v ON v.id = t.id
      LEFT JOIN ts_ranked  s ON s.id = t.id
      WHERE v.id IS NOT NULL OR s.id IS NOT NULL
      ORDER BY score DESC
      LIMIT 50"
    `);
  });

  it("inlines custom weights, rrfK, and limit verbatim", () => {
    const sql = buildHybridSearchSql({
      ...baseInput,
      weights: { vector: 0.7, text: 0.3 },
      rrfK: 20,
      limit: 100,
    });
    expect(sql.startsWith("-- pgvector hybrid search (RRF)\n")).toBe(true);
    expect(lastNonEmptyLine(sql)).toBe("LIMIT 100");
    expect(sql).toContain("0.7 / (20 +");
    expect(sql).toContain("0.3 / (20 +");
    expect(sql).toMatchInlineSnapshot(`
      "-- pgvector hybrid search (RRF)

      WITH vec_ranked AS (        SELECT id, ROW_NUMBER() OVER (                 ORDER BY embedding <-> '[0.1,0.2]'::vector
) AS rnk
        FROM public.items
        ORDER BY embedding <-> '[0.1,0.2]'::vector
        LIMIT 200
),
      ts_ranked AS (        SELECT id, ROW_NUMBER() OVER (                 ORDER BY ts_rank_cd(title_ts, plainto_tsquery('hello')) DESC
) AS rnk
        FROM public.items
        WHERE title_ts @@ plainto_tsquery('hello')
        LIMIT 200
)
      SELECT t.*,
             (COALESCE(0.7 / (20 + v.rnk)::float, 0)
            + COALESCE(0.3 / (20 + s.rnk)::float, 0)) AS score
      FROM public.items t
      LEFT JOIN vec_ranked v ON v.id = t.id
      LEFT JOIN ts_ranked  s ON s.id = t.id
      WHERE v.id IS NOT NULL OR s.id IS NOT NULL
      ORDER BY score DESC
      LIMIT 100"
    `);
  });

  it("inlines a function-call pivot expression verbatim", () => {
    const sql = buildHybridSearchSql({
      ...baseInput,
      vectorPivotExpr: "embed('hi')",
    });
    expect(sql.startsWith("-- pgvector hybrid search (RRF)\n")).toBe(true);
    expect(lastNonEmptyLine(sql)).toBe("LIMIT 50");
    expect(sql).toContain("embed('hi')");
    expect(sql).toMatchInlineSnapshot(`
      "-- pgvector hybrid search (RRF)

      WITH vec_ranked AS (        SELECT id, ROW_NUMBER() OVER (                 ORDER BY embedding <-> embed('hi')
) AS rnk
        FROM public.items
        ORDER BY embedding <-> embed('hi')
        LIMIT 200
),
      ts_ranked AS (        SELECT id, ROW_NUMBER() OVER (                 ORDER BY ts_rank_cd(title_ts, plainto_tsquery('hello')) DESC
) AS rnk
        FROM public.items
        WHERE title_ts @@ plainto_tsquery('hello')
        LIMIT 200
)
      SELECT t.*,
             (COALESCE(0.5 / (60 + v.rnk)::float, 0)
            + COALESCE(0.5 / (60 + s.rnk)::float, 0)) AS score
      FROM public.items t
      LEFT JOIN vec_ranked v ON v.id = t.id
      LEFT JOIN ts_ranked  s ON s.id = t.id
      WHERE v.id IS NOT NULL OR s.id IS NOT NULL
      ORDER BY score DESC
      LIMIT 50"
    `);
  });

  it("escapes single quotes in tsQuery via the SQL doubling rule", () => {
    const sql = buildHybridSearchSql({ ...baseInput, tsQuery: "Bob's" });
    expect(sql).toContain("plainto_tsquery('Bob''s')");
  });
});
