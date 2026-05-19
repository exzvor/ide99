// — owner: (knn-projection).
// Pure helper that scans a list of `{ name, typeName }` column metadata entries
// and surfaces those whose Postgres type comes from `pgvector` (vector,
// halfvec, sparsevec). The dimension is extracted when the type spelling
// includes one (e.g. `vector(768)`); columns declared without a dim
// (e.g. plain `sparsevec`) yield `dim: null`.
export type DetectedVectorColumn = { name: string; type: string; dim: number | null };
export type DetectedVectors = { vectorColumns: DetectedVectorColumn[] };

const VECTOR_TYPE_RE = /^(vector|halfvec|sparsevec)(\((\d+)\))?$/i;

export function detectVectorColumns(  columns: { name: string; typeName: string }[],
): DetectedVectors {
  const out: DetectedVectorColumn[] = [];
  for (const col of columns) {
    const m = VECTOR_TYPE_RE.exec(col.typeName);
    if (!m) continue;
    const type = m[1].toLowerCase();
    const dim = m[3] ? Number.parseInt(m[3], 10) : null;
    out.push({ name: col.name, type, dim });
  }
  return { vectorColumns: out };
}
