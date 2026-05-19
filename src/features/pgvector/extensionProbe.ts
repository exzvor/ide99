// — pgvector — runtime probe for the `vector` extension.
// Used by the IndexEditor wizard button to gate visibility, and by the
// SchemaBrowser per-table panel to decide whether to render at all.
import { queryExecute } from "../../lib/tauri";

const cache = new Map<string, boolean>();

/** Returns true iff `pg_extension` row for `vector` exists. Cached per connId. */
export async function isPgvectorInstalled(connId: string): Promise<boolean> {
  const cached = cache.get(connId);
  if (cached !== undefined) return cached;
  const result = await queryExecute(
    connId,
    "SELECT 1 FROM pg_extension WHERE extname = 'vector' LIMIT 1",
  );
  const installed = result.rows.length > 0;
  cache.set(connId, installed);
  return installed;
}

/** Test-only: clear the probe cache. */
export function _clearPgvectorProbeCache(): void {
  cache.clear();
}
