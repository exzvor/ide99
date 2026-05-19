// — owner: .
// Web Worker that lazy-loads `umap-js` and runs a 2D UMAP fit on demand.
// The worker accepts a single `{ type: 'project', vectors, opts? }` message,
// returns either `{ type: 'done', xy }` or `{ type: 'error', message }`,
// and is then terminated by the caller. Vite handles the bundling via the
// `new Worker(new URL(...), { type: 'module' })` recipe at the call site.
self.onmessage = async (e: MessageEvent) => {
  const data = e.data as
    | {
        type: "project";
        vectors: Float32Array[];
        opts?: { nNeighbors?: number; minDist?: number; nEpochs?: number };
      }
    | undefined;
  if (!data || data.type !== "project") return;
  try {
    const { UMAP } = await import("umap-js");
    const umap = new UMAP({
      nComponents: 2,
      nNeighbors: data.opts?.nNeighbors ?? 15,
      minDist: data.opts?.minDist ?? 0.1,
      nEpochs: data.opts?.nEpochs ?? 200,
    });
    const points = data.vectors.map((v) => Array.from(v));
    const out = umap.fit(points);
    const xy = out.map((row: number[]) => Float32Array.from(row));
    (self as unknown as Worker).postMessage({ type: "done", xy });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
export {};
