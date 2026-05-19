// — owner: .
// Bulk-loads hypertable + continuous-aggregate metadata for one connection
// and mirrors the result into the `useTimescale` zustand store so SchemaTree
// rows can re-render reactively. Failure modes (permission denied, missing
// extension) degrade gracefully to an empty map — never throws.
import { queryExecute } from "../../lib/tauri";
import { type HypertableMap, type HypertableRecord, useTimescale } from "./store";

export type { HypertableMap, HypertableRecord };

const LOAD_QUERY = `SELECT
  h.schema_name,
  h.table_name,
  (ca.view_name IS NOT NULL) AS is_continuous_aggregate,
  ca.view_schema,
  ca.view_name
FROM _timescaledb_catalog.hypertable h
LEFT JOIN timescaledb_information.continuous_aggregates ca
  ON ca.materialization_hypertable_schema = h.schema_name
 AND ca.materialization_hypertable_name = h.table_name`;

let warned = false;

function parseBool(value: string | null): boolean {
  if (value === null) return false;
  const v = value.toLowerCase();
  return v === "t" || v === "true";
}

export async function loadHypertables(connId: string): Promise<HypertableMap> {
  const map: HypertableMap = new Map();
  try {
    const result = await queryExecute(connId, LOAD_QUERY);
    for (const row of result.rows) {
      const schema = row[0];
      const name = row[1];
      const isCA = parseBool(row[2]);
      const viewSchema = row[3];
      const viewName = row[4];
      if (schema === null || name === null) continue;
      const record: HypertableRecord = {
        isHypertable: true,
        isContinuousAggregate: isCA,
      };
      // Always index by the underlying hypertable schema/name.
      map.set(`${schema}/${name}`, record);
      // For continuous aggregates, also alias by the public view name —
      // users think in terms of the CA they created, not the materialization.
      if (isCA && viewSchema !== null && viewName !== null) {
        map.set(`${viewSchema}/${viewName}`, record);
      }
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      // Swallow permission/extension errors so the SchemaTree keeps working.
      console.warn(
        "[timescale] loadHypertables failed; treating connection as having no hypertables.",
        err,
      );
    }
    useTimescale.getState().setHypertables(connId, map);
    return map;
  }
  useTimescale.getState().setHypertables(connId, map);
  return map;
}

export function isHypertable(connId: string, schema: string, name: string): boolean {
  const map = useTimescale.getState().hypertables.get(connId);
  return map?.has(`${schema}/${name}`) ?? false;
}

export function isContinuousAggregate(connId: string, schema: string, name: string): boolean {
  const map = useTimescale.getState().hypertables.get(connId);
  const record = map?.get(`${schema}/${name}`);
  return record?.isContinuousAggregate ?? false;
}

export function invalidateHypertableCache(connId?: string): void {
  useTimescale.getState().clear(connId);
}

// Test-only: reset the once-warned guard so console.warn assertions are
// independent across test cases.
export function _clearHypertableRegistry(): void {
  warned = false;
  useTimescale.getState().clear();
}
