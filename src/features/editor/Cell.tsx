import { type JSX, useState } from "react";
import type { ColumnMeta } from "../../lib/tauri";
import { GeometryCellSvg, parseEwkbHex } from "../postgis";
import { JsonCell } from "./JsonCell";
import { ValueModal } from "./ValueModal";

const JSON_TYPES = new Set(["json", "jsonb"]);
const BOOL_TYPES = new Set(["bool"]);

function isGeometryType(typeName: string): boolean {
  return /^(geometry|geography)(\(|$)/i.test(typeName);
}

export interface CellProps {
  column: ColumnMeta;
  value: string | null;
}

/**
 * Typed cell renderer.
 *
 * - NULL → italic gray "NULL"
 * - json/jsonb → single-line monospace, dblclick → modal pretty-printed
 * - bool → plain text
 * - numeric → right-aligned monospace tabular-nums
 * - everything else → plain text + ellipsis, dblclick → modal raw
 */
export function Cell({ column, value }: CellProps): JSX.Element {
  if (value === null) {
    return <span className="cell-null italic text-[var(--gray-400)]">NULL</span>;
  }
  if (JSON_TYPES.has(column.typeName)) {
    return <JsonCell value={value} />;
  }
  if (isGeometryType(column.typeName)) {
    if (value === "") return <PlainCell value="" />;
    const geom = parseEwkbHex(value);
    return <GeometryCellSvg geom={geom} />;
  }
  if (BOOL_TYPES.has(column.typeName)) {
    return <span>{value}</span>;
  }
  if (column.isNumeric) {
    return (
      <span className="cell-numeric block w-full text-right font-mono tabular-nums">{value}</span>
    );
  }
  return <PlainCell value={value} />;
}

function PlainCell({ value }: { value: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span
        className="block w-full overflow-hidden text-ellipsis whitespace-nowrap"
        title={value}
        onDoubleClick={() => setOpen(true)}
      >
        {value}
      </span>
      <ValueModal open={open} onClose={() => setOpen(false)} value={value} language="text" />
    </>
  );
}
