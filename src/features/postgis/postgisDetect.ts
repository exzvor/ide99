// — owner: .
// Pure: ColumnMeta-shaped input → DetectedGeometryColumn[].

export type DetectedGeometryColumn = {
  name: string;
  type: "geometry" | "geography";
  srid: number | null;
};

const TYPE_RE = /^(geometry|geography)(\((\w+),\s*(\d+)\))?$/i;

export function detectGeometryColumns(
  columns: { name: string; typeName: string }[],
): DetectedGeometryColumn[] {
  const out: DetectedGeometryColumn[] = [];
  for (const col of columns) {
    const match = TYPE_RE.exec(col.typeName);
    if (!match) continue;
    const type = match[1].toLowerCase() as "geometry" | "geography";
    const sridStr = match[4];
    const srid = sridStr ? Number.parseInt(sridStr, 10) : null;
    out.push({ name: col.name, type, srid });
  }
  return out;
}
