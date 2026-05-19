// — owner: .
//
// Pure helper that builds the `SELECT pk, geom FROM table LIMIT N` snippet
// that PostgisTablePanel runs to seed a Map View tab. Extracted from the
// panel for clean unit testing — no React, no IPC.
export function buildOpenMapViewSql(input: {
  qualifiedTable: string;
  pk: string | null;
  geometryColumn: string;
  limit?: number;
}): string {
  const lim = input.limit ?? 5000;
  const cols = input.pk ? `${input.pk}, ${input.geometryColumn}` : `${input.geometryColumn}`;
  return `SELECT ${cols} FROM ${input.qualifiedTable} LIMIT ${lim}`;
}
