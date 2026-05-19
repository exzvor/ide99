// — owner: (parsing-projection).
// Pure EWKB hex parser. Returns a discriminated `Geometry` union; never throws.
// Malformed / unsupported variants → `{ type: "Unsupported", reason }`.

export type Geometry =
  | { type: "Point"; coords: [number, number]; srid: number }
  | { type: "LineString"; coords: [number, number][]; srid: number }
  | { type: "Polygon"; coords: [number, number][][]; srid: number }
  | { type: "MultiPoint"; coords: [number, number][]; srid: number }
  | { type: "MultiLineString"; coords: [number, number][][]; srid: number }
  | { type: "MultiPolygon"; coords: [number, number][][][]; srid: number }
  | { type: "Unsupported"; reason: string };

const SRID_FLAG = 0x20000000;
const Z_FLAG = 0x80000000;
const M_FLAG = 0x40000000;

const TYPE_POINT = 1;
const TYPE_LINESTRING = 2;
const TYPE_POLYGON = 3;
const TYPE_MULTIPOINT = 4;
const TYPE_MULTILINESTRING = 5;
const TYPE_MULTIPOLYGON = 6;
const TYPE_GEOMETRYCOLLECTION = 7;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

class Reader {
  private view: DataView;
  private offset = 0;
  private littleEndian = true;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readByteOrder(): void {
    const byte = this.readUint8();
    this.littleEndian = byte === 1;
  }

  readUint8(): number {
    if (this.offset + 1 > this.view.byteLength) throw new RangeError("oob");
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readUint32(): number {
    if (this.offset + 4 > this.view.byteLength) throw new RangeError("oob");
    const v = this.view.getUint32(this.offset, this.littleEndian);
    this.offset += 4;
    return v;
  }

  readFloat64(): number {
    if (this.offset + 8 > this.view.byteLength) throw new RangeError("oob");
    const v = this.view.getFloat64(this.offset, this.littleEndian);
    this.offset += 8;
    return v;
  }
}

function readPoint(r: Reader): [number, number] {
  const x = r.readFloat64();
  const y = r.readFloat64();
  return [x, y];
}

function readLineCoords(r: Reader): [number, number][] {
  const n = r.readUint32();
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push(readPoint(r));
  return out;
}

function readPolygonCoords(r: Reader): [number, number][][] {
  const ringCount = r.readUint32();
  const rings: [number, number][][] = [];
  for (let i = 0; i < ringCount; i++) rings.push(readLineCoords(r));
  return rings;
}

function parseGeometry(r: Reader, srid: number, isTop: boolean): Geometry {
  if (!isTop) {
    // Sub-geometries carry their own byte-order header but no SRID prefix.
    r.readByteOrder();
  }
  const typeWord = r.readUint32();
  const baseType = typeWord & 0xffff;
  const hasZ = (typeWord & Z_FLAG) !== 0;
  const hasM = (typeWord & M_FLAG) !== 0;
  const hasSrid = (typeWord & SRID_FLAG) !== 0;

  // Top-level: SRID flag may set srid; sub-geoms ignore SRID prefix per EWKB.
  if (isTop && hasSrid) {
    srid = r.readUint32();
  }

  if (hasZ || hasM) {
    return { type: "Unsupported", reason: "3D/4D geometry not supported in v1" };
  }

  switch (baseType) {
    case TYPE_POINT:
      return { type: "Point", coords: readPoint(r), srid };
    case TYPE_LINESTRING:
      return { type: "LineString", coords: readLineCoords(r), srid };
    case TYPE_POLYGON:
      return { type: "Polygon", coords: readPolygonCoords(r), srid };
    case TYPE_MULTIPOINT: {
      const n = r.readUint32();
      const out: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const sub = parseGeometry(r, srid, false);
        if (sub.type === "Unsupported") return sub;
        if (sub.type !== "Point") {
          return { type: "Unsupported", reason: "malformed EWKB" };
        }
        out.push(sub.coords);
      }
      return { type: "MultiPoint", coords: out, srid };
    }
    case TYPE_MULTILINESTRING: {
      const n = r.readUint32();
      const out: [number, number][][] = [];
      for (let i = 0; i < n; i++) {
        const sub = parseGeometry(r, srid, false);
        if (sub.type === "Unsupported") return sub;
        if (sub.type !== "LineString") {
          return { type: "Unsupported", reason: "malformed EWKB" };
        }
        out.push(sub.coords);
      }
      return { type: "MultiLineString", coords: out, srid };
    }
    case TYPE_MULTIPOLYGON: {
      const n = r.readUint32();
      const out: [number, number][][][] = [];
      for (let i = 0; i < n; i++) {
        const sub = parseGeometry(r, srid, false);
        if (sub.type === "Unsupported") return sub;
        if (sub.type !== "Polygon") {
          return { type: "Unsupported", reason: "malformed EWKB" };
        }
        out.push(sub.coords);
      }
      return { type: "MultiPolygon", coords: out, srid };
    }
    case TYPE_GEOMETRYCOLLECTION:
      return {
        type: "Unsupported",
        reason: "GeometryCollection not supported in v1",
      };
    default:
      return { type: "Unsupported", reason: `unknown geometry type ${baseType}` };
  }
}

export function parseEwkbHex(hex: string): Geometry {
  const bytes = hexToBytes(hex);
  if (!bytes) return { type: "Unsupported", reason: "malformed EWKB" };
  try {
    const reader = new Reader(bytes);
    reader.readByteOrder();
    return parseGeometry(reader, 0, true);
  } catch {
    return { type: "Unsupported", reason: "malformed EWKB" };
  }
}
