// — owner: .
//
// Pure SQL builder for the Hybrid Search wizard. Produces a CTE + RRF query
// that combines pgvector distance (`<vec_col> <op> <pivot>`) with full-text
// ranking (`ts_rank_cd(<ts_col>, plainto_tsquery(<q>))`). All values are
// inlined as SQL literals — the caller is responsible for choosing the
// pivot form (literal vector vs SQL function call) and quoting identifiers.
//
// The output is prefixed with a stable `-- pgvector hybrid search (RRF)`
// comment so smoke tests / users can identify it in the editor tab.

export type DistanceOp = "<->" | "<#>" | "<=>";

export type HybridSearchInput = {
  qualifiedTable: string;
  pk: string;
  vectorCol: string;
  /**
   * Pre-built SQL expression yielding a `vector` value. Caller decides whether
   * this is a literal (`'[0.1,0.2]'::vector`) or a function call (`embed('hi')`)
   * and is responsible for quoting/escaping inside.
   */
  vectorPivotExpr: string;
  tsCol: string;
  tsQuery: string;
  distanceOp: DistanceOp;
  weights: { vector: number; text: number };
  rrfK: number;
  limit: number;
};

/** Standard SQL single-quote escape: `'` → `''`. */
function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

export function buildHybridSearchSql(input: HybridSearchInput): string {
  const {
    qualifiedTable,
    pk,
    vectorCol,
    vectorPivotExpr,
    tsCol,
    tsQuery,
    distanceOp,
    weights,
    rrfK,
    limit,
  } = input;

  const wV = String(weights.vector);
  const wT = String(weights.text);
  const k = String(rrfK);
  const lim = String(limit);
  const tsLit = `'${escapeSqlString(tsQuery)}'`;

  return [
    "-- pgvector hybrid search (RRF)",
    "",
    "WITH vec_ranked AS (",
    `  SELECT ${pk}, ROW_NUMBER() OVER (`,
    `           ORDER BY ${vectorCol} ${distanceOp} ${vectorPivotExpr}`,
    ") AS rnk",
    `  FROM ${qualifiedTable}`,
    `  ORDER BY ${vectorCol} ${distanceOp} ${vectorPivotExpr}`,
    "  LIMIT 200",
    "),",
    "ts_ranked AS (",
    `  SELECT ${pk}, ROW_NUMBER() OVER (`,
    `           ORDER BY ts_rank_cd(${tsCol}, plainto_tsquery(${tsLit})) DESC`,
    ") AS rnk",
    `  FROM ${qualifiedTable}`,
    `  WHERE ${tsCol} @@ plainto_tsquery(${tsLit})`,
    "  LIMIT 200",
    ")",
    "SELECT t.*,",
    `       (COALESCE(${wV} / (${k} + v.rnk)::float, 0)`,
    `      + COALESCE(${wT} / (${k} + s.rnk)::float, 0)) AS score`,
    `FROM ${qualifiedTable} t`,
    `LEFT JOIN vec_ranked v ON v.${pk} = t.${pk}`,
    `LEFT JOIN ts_ranked  s ON s.${pk} = t.${pk}`,
    `WHERE v.${pk} IS NOT NULL OR s.${pk} IS NOT NULL`,
    "ORDER BY score DESC",
    `LIMIT ${lim}`,
  ].join("\n");
}
