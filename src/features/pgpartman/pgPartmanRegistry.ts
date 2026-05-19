// — bulk-loads pg_partman parent metadata for one connection and
// mirrors the result into the `usePgPartman` zustand store so SchemaTree rows
// and per-table panels can re-render reactively. Mirrors the timescale
// hypertableRegistry pattern: failure modes (permission denied, missing
// schema) degrade to an empty map without throwing.
import { queryExecute } from "../../lib/tauri";
import { type PartmanMap, type PartmanParent, usePgPartman } from "./store";

export type { PartmanMap, PartmanParent };

const LOAD_QUERY = `SELECT
  parent_table,
  control,
  partition_interval,
  retention,
  premake
FROM partman.part_config`;

let warned = false;

export async function loadPgPartmanParents(connId: string): Promise<PartmanMap> {
  const map: PartmanMap = new Map();
  try {
    const result = await queryExecute(connId, LOAD_QUERY);
    for (const row of result.rows) {
      const parentTable = row[0];
      const control = row[1];
      const intervalText = row[2];
      const retention = row[3];
      const premakeRaw = row[4];
      if (parentTable === null || control === null || intervalText === null) continue;
      // partman stores parent_table as un-quoted "schema.table" text. Split on
      // the FIRST `.` only — table names with embedded dots stay intact.
      const dotIdx = parentTable.indexOf(".");
      if (dotIdx <= 0 || dotIdx === parentTable.length - 1) continue;
      const schema = parentTable.slice(0, dotIdx);
      const table = parentTable.slice(dotIdx + 1);
      const premakeCount = premakeRaw === null ? 0 : Number.parseInt(premakeRaw, 10) || 0;
      const record: PartmanParent = {
        schema,
        table,
        controlColumn: control,
        intervalText,
        retentionText: retention,
        premakeCount,
      };
      map.set(`${schema}/${table}`, record);
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        "[pgpartman] loadPgPartmanParents failed; treating connection as having no partman parents.",
        err,
      );
    }
    usePgPartman.getState().setParents(connId, map);
    return map;
  }
  usePgPartman.getState().setParents(connId, map);
  return map;
}

export function isPartmanParent(connId: string, schema: string, table: string): boolean {
  const map = usePgPartman.getState().parents.get(connId);
  return map?.has(`${schema}/${table}`) ?? false;
}

export function invalidatePgPartmanCache(connId?: string): void {
  usePgPartman.getState().clear(connId);
}

// Test-only: reset the once-warned guard so console.warn assertions stay
// independent across test cases.
export function _clearPgPartmanRegistry(): void {
  warned = false;
  usePgPartman.getState().clear();
}
