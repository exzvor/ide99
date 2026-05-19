// — owner: .
// Renders an 800×600 2D projection of a sampled vector column.
// On mount we sample up to 5 000 rows (`ORDER BY random()` for ordinary
// tables, `TABLESAMPLE BERNOULLI(p)` for tables with > 500k rows so
// the planner doesn't full-scan + sort), parse each vector literal, run
// synchronous PCA, and draw points on a canvas. A "Refine with UMAP"
// button spawns the lazy-loaded UMAP worker and replaces the points
// with its 2-D output once it finishes.
import { type JSX, useEffect, useRef, useState } from "react";
import { queryExecute } from "../../lib/tauri";
import { pcaProject } from "./pcaProject";

export interface VectorProjectionViewProps {
  connId: string;
  qualifiedTable: string;
  pk: string;
  vectorColumn: string;
  rowCount: number;
  onClose: () => void;
}

const CANVAS_W = 800;
const CANVAS_H = 600;
const PADDING = 20;

function buildSampleSql(  qualifiedTable: string,
  pk: string,
  vectorColumn: string,
  rowCount: number,
): { sql: string; usedTablesample: boolean } {
  if (rowCount > 500_000) {
    const p = Math.min(100, (5000 * 100) / rowCount);
    // Format with reasonable precision; Postgres accepts decimals here.
    const pStr = p.toFixed(4);
    return {
      sql:
        `SELECT ${pk}, ${vectorColumn} FROM ${qualifiedTable} ` +
        `TABLESAMPLE BERNOULLI(${pStr}) LIMIT 5000`,
      usedTablesample: true,
    };
  }
  return {
    sql: `SELECT ${pk}, ${vectorColumn} FROM ${qualifiedTable} ORDER BY random() LIMIT 5000`,
    usedTablesample: false,
  };
}

function parseVectorLiteral(s: string | null): Float32Array | null {
  if (!s) return null;
  try {
    const arr = JSON.parse(s) as unknown;
    if (!Array.isArray(arr)) return null;
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const n = Number(arr[i]);
      if (!Number.isFinite(n)) return null;
      out[i] = n;
    }
    return out;
  } catch {
    return null;
  }
}

function drawPoints(canvas: HTMLCanvasElement, points: Float32Array[]): void {
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return;
  }
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (points.length === 0) return;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const w = canvas.width - PADDING * 2;
  const h = canvas.height - PADDING * 2;

  ctx.fillStyle = "rgba(60, 120, 220, 0.55)";
  for (const p of points) {
    const x = PADDING + ((p[0] - minX) / dx) * w;
    const y = PADDING + ((p[1] - minY) / dy) * h;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function VectorProjectionView(props: VectorProjectionViewProps): JSX.Element {
  const { connId, qualifiedTable, pk, vectorColumn, rowCount, onClose } = props;
  const [points, setPoints] = useState<Float32Array[]>([]);
  const [vectors, setVectors] = useState<Float32Array[]>([]);
  const [usedTablesample, setUsedTablesample] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sample + initial PCA on mount / when inputs change.
  useEffect(() => {
    let cancelled = false;
    const { sql, usedTablesample: tbs } = buildSampleSql(      qualifiedTable,
      pk,
      vectorColumn,
      rowCount,
);
    setUsedTablesample(tbs);
    setFetchError(null);

    queryExecute(connId, sql)
      .then((result) => {
        if (cancelled) return;
        // Find the vector column index — typically position 1, but be defensive.
        const idx = result.columns.findIndex((c) => c.name === vectorColumn);
        const vecIdx = idx >= 0 ? idx : result.columns.length - 1;
        const parsed: Float32Array[] = [];
        for (const row of result.rows) {
          const v = parseVectorLiteral(row[vecIdx]);
          if (v) parsed.push(v);
        }
        setVectors(parsed);
        const projected = pcaProject(parsed);
        setPoints(projected);
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [connId, qualifiedTable, pk, vectorColumn, rowCount]);

  // Redraw whenever the projected points change.
  useEffect(() => {
    if (canvasRef.current) drawPoints(canvasRef.current, points);
  }, [points]);

  const handleRefine = () => {
    if (vectors.length === 0 || refining) return;
    setRefining(true);
    setRefineError(null);
    let worker: Worker;
    try {
      worker = new Worker(new URL("./umap.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (err) {
      setRefining(false);
      setRefineError(err instanceof Error ? err.message : String(err));
      return;
    }
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: "done"; xy: Float32Array[] }
        | { type: "error"; message: string }
        | undefined;
      if (!msg) {
        setRefining(false);
        worker.terminate();
        return;
      }
      if (msg.type === "done") {
        setPoints(msg.xy);
        setRefining(false);
      } else if (msg.type === "error") {
        setRefineError(msg.message);
        setRefining(false);
      }
      worker.terminate();
    };
    worker.onerror = (e: ErrorEvent) => {
      setRefineError(e.message || "UMAP worker error");
      setRefining(false);
      worker.terminate();
    };
    worker.postMessage({ type: "project", vectors });
  };

  return (    <div data-testid="vector-projection-view" style={{ padding: 12 }}>
      {usedTablesample && (        <div
          data-testid="vector-projection-banner"
          style={{
            background: "var(--warn-bg, #ffeec2)",
            padding: 8,
            fontSize: 12.5,
            marginBottom: 8,
          }}
        >
          Using TABLESAMPLE for large table
        </div>
)}
      {fetchError && (        <div
          data-testid="vector-projection-fetch-error"
          style={{ color: "var(--danger)", padding: 8, fontSize: 12.5 }}
        >
          {fetchError}
        </div>
)}
      <div style={{ position: "relative", width: CANVAS_W, height: CANVAS_H }}>
        <canvas
          ref={canvasRef}
          data-testid="vector-projection-canvas"
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ background: "var(--ink-7, #fafafa)", display: "block" }}
        />
        {refining && (          <div
            data-testid="vector-projection-loading"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.6)",
              fontSize: 13,
            }}
          >
            Running UMAP…
          </div>
)}
      </div>
      {refineError && (        <div
          data-testid="vector-projection-error"
          style={{ color: "var(--danger)", padding: 8, fontSize: 12.5 }}
        >
          {refineError}
        </div>
)}
      <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          data-testid="projection-refine"
          className="btn btn-secondary"
          onClick={handleRefine}
          disabled={refining || vectors.length === 0}
        >
          Refine with UMAP
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
);
}
