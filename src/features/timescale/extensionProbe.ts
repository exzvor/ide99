// — runtime probe for the `timescaledb` extension.
// Cached per connId; mirrors features/pgvector/extensionProbe.ts and
// features/postgis/extensionProbe.ts.
import { queryExecute } from "../../lib/tauri";

const cache = new Map<string, boolean>();

export async function isTimescaleInstalled(connId: string): Promise<boolean> {
  const cached = cache.get(connId);
  if (cached !== undefined) return cached;
  const result = await queryExecute(
    connId,
    "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb' LIMIT 1",
  );
  const installed = result.rows.length > 0;
  cache.set(connId, installed);
  return installed;
}

export function _clearTimescaleProbeCache(): void {
  cache.clear();
}
