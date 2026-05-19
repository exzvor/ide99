// — pg_stat_statements runtime probe.
import { queryExecute } from "../../lib/tauri";

const cache = new Map<string, boolean>();

export async function isPgStatStatementsInstalled(connId: string): Promise<boolean> {
  const cached = cache.get(connId);
  if (cached !== undefined) return cached;
  const result = await queryExecute(    connId,
    "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements' LIMIT 1",
);
  const installed = result.rows.length > 0;
  cache.set(connId, installed);
  return installed;
}

export function _clearPgStatStatementsProbeCache(): void {
  cache.clear();
}
