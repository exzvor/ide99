// — owner: .
// Pure: ColumnMeta[] → time-column candidates. TimescaleDB hypertables accept
// timestamp / timestamptz / date columns plus integer-typed (epoch) columns
// (int2/4/8 + their long-form aliases). Order is preserved so callers can
// drive a <select> in the column order the user already expects.
export type TimeColumnCandidate = { name: string; typeName: string };

const TIME_TYPES = new Set<string>([
  "timestamp",
  "timestamp without time zone",
  "timestamptz",
  "timestamp with time zone",
  "date",
  "int2",
  "int4",
  "int8",
  "bigint",
  "integer",
  "smallint",
]);

export function detectTimeColumns(
  columns: { name: string; typeName: string }[],
): TimeColumnCandidate[] {
  const out: TimeColumnCandidate[] = [];
  for (const col of columns) {
    if (TIME_TYPES.has(col.typeName)) {
      out.push({ name: col.name, typeName: col.typeName });
    }
  }
  return out;
}
