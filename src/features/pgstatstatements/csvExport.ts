// — owner: .
//
// RFC-4180 CSV serializer used by the pg_stat_statements tab export
// button. Cells containing commas, double quotes, newlines or carriage
// returns are wrapped in double quotes; embedded double quotes are
// escaped by doubling. `null` is rendered as an empty (unquoted) cell.
export function rowsToCsv(columns: string[], rows: (string | null)[][]): string {
  const escape = (cell: string | null): string => {
    if (cell === null) return "";
    if (/[",\n\r]/.test(cell)) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };
  const header = columns.map(escape).join(",");
  const body = rows.map((row) => row.map(escape).join(",")).join("\n");
  return `${header}\n${body}`;
}
