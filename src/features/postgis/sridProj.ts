// — owner: .
// Client-side SRID projection helper. Supports 4326 (passthrough), 3857, 4269.
import proj4 from "proj4";

export const KNOWN_SRIDS = new Set<number>([0, 4326, 3857, 4269]);

// proj4 ships EPSG:4326 and EPSG:3857 by default. Register NAD83 once.
proj4.defs("EPSG:4269", "+proj=longlat +datum=NAD83 +no_defs");

export function toWgs84(coord: [number, number], fromSrid: number): [number, number] | null {
  if (fromSrid === 0 || fromSrid === 4326) return coord;
  if (!KNOWN_SRIDS.has(fromSrid)) return null;
  const result = proj4(`EPSG:${fromSrid}`, "EPSG:4326", coord) as [number, number];
  return result;
}
