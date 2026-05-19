// — owner: .
// Synchronous 2D PCA projection. Computes the top two principal components of
// a set of d-dimensional vectors via power iteration with deflation on the
// d×d covariance matrix, then projects every input onto those axes.
//
// Input vectors must all share the same dimension `d`. The implementation
// short-circuits the obvious degenerate cases (empty input, single vector,
// all-zero data, d===1) so callers get well-defined zero-axis output instead
// of NaNs from a singular covariance matrix.

const POWER_ITERATIONS = 100;
const POWER_TOL = 1e-9;

export function pcaProject(vectors: Float32Array[]): Float32Array[] {
  if (vectors.length === 0) return [];
  const n = vectors.length;
  const d = vectors[0].length;
  if (d === 0) return vectors.map(() => new Float32Array(2));

  // Mean centering.
  const mean = new Float64Array(d);
  for (const v of vectors) {
    for (let i = 0; i < d; i++) mean[i] += v[i];
  }
  for (let i = 0; i < d; i++) mean[i] /= n;

  const centered: Float64Array[] = vectors.map((v) => {
    const c = new Float64Array(d);
    for (let i = 0; i < d; i++) c[i] = v[i] - mean[i];
    return c;
  });

  // d×d covariance (symmetric). For small d this is fine; vectors here are
  // typically <= a few thousand dims and we're sampling at most ~5k rows.
  const cov = new Float64Array(d * d);
  for (const c of centered) {
    for (let i = 0; i < d; i++) {
      const ci = c[i];
      if (ci === 0) continue;
      for (let j = 0; j < d; j++) {
        cov[i * d + j] += ci * c[j];
      }
    }
  }
  // Divide by (n-1) — using n is fine too since it just rescales eigenvalues
  // and we only care about eigenvectors. Use max(1, n-1) to avoid div by zero.
  const denom = Math.max(1, n - 1);
  for (let k = 0; k < cov.length; k++) cov[k] /= denom;

  // Top eigenvector via power iteration.
  const pc1 = topEigenvector(cov, d);
  // Deflate and find the second.
  let pc2: Float64Array;
  if (d === 1) {
    pc2 = new Float64Array(1); // unused — we'll zero-fill axis 2.
  } else {
    deflate(cov, d, pc1);
    pc2 = topEigenvector(cov, d);
  }

  const out: Float32Array[] = [];
  for (const c of centered) {
    const p = new Float32Array(2);
    let s1 = 0;
    for (let i = 0; i < d; i++) s1 += c[i] * pc1[i];
    p[0] = s1;
    if (d > 1) {
      let s2 = 0;
      for (let i = 0; i < d; i++) s2 += c[i] * pc2[i];
      p[1] = s2;
    } else {
      p[1] = 0;
    }
    out.push(p);
  }
  return out;
}

function topEigenvector(m: Float64Array, d: number): Float64Array {
  // Initial guess: deterministic non-zero vector.
  let v = new Float64Array(d);
  for (let i = 0; i < d; i++) v[i] = 1 / Math.sqrt(d);

  let prevNorm = 0;
  for (let iter = 0; iter < POWER_ITERATIONS; iter++) {
    const next = new Float64Array(d);
    for (let i = 0; i < d; i++) {
      let s = 0;
      for (let j = 0; j < d; j++) s += m[i * d + j] * v[j];
      next[i] = s;
    }
    let norm = 0;
    for (let i = 0; i < d; i++) norm += next[i] * next[i];
    norm = Math.sqrt(norm);
    if (norm < 1e-18) {
      // Matrix is (numerically) zero — return a zero eigenvector.
      return new Float64Array(d);
    }
    for (let i = 0; i < d; i++) next[i] /= norm;
    if (Math.abs(norm - prevNorm) < POWER_TOL) {
      v = next;
      break;
    }
    prevNorm = norm;
    v = next;
  }
  return v;
}

function deflate(m: Float64Array, d: number, ev: Float64Array): void {
  // Subtract λ·(ev ev^T) where λ = ev^T M ev.
  const mev = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    let s = 0;
    for (let j = 0; j < d; j++) s += m[i * d + j] * ev[j];
    mev[i] = s;
  }
  let lambda = 0;
  for (let i = 0; i < d; i++) lambda += ev[i] * mev[i];
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      m[i * d + j] -= lambda * ev[i] * ev[j];
    }
  }
}
