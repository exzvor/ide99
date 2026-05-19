/**
 * — exporters (, task C4).
 *
 * Two tiny browser-side helpers. Both live entirely in the renderer and
 * trigger a download via a transient `<a download>` anchor — no Tauri
 * fs commands needed since the target file ends up in the user's
 * Downloads folder via the browser/webview's regular flow.
 *
 * - `exportSvg(svg, filename)`: serialize → Blob('image/svg+xml') →
 * ObjectURL → anchor click → revoke.
 * - `exportPng(svg, filename, scale)`: serialize → data URL → load
 * into Image → drawImage onto a canvas at `scale × svg.width × svg.height`
 * → canvas.toBlob('image/png') → ObjectURL → anchor click → revoke.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_XMLNS_ATTR = "xmlns";

/**
 * Ensure the `xmlns` attribute is on the serialized root so the file
 * renders standalone in browsers / image viewers.
 */
function serializeSvg(svg: SVGSVGElement): string {
  const cloned = svg.cloneNode(true) as SVGSVGElement;
  if (!cloned.getAttribute(SVG_XMLNS_ATTR)) {
    cloned.setAttribute(SVG_XMLNS_ATTR, SVG_NS);
  }
  return new XMLSerializer().serializeToString(cloned);
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Some browsers require the anchor to be in the DOM to honor `download`.
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function readSvgPixelSize(svg: SVGSVGElement): { width: number; height: number } {
  // Prefer explicit attributes; fall back to viewBox; finally to bounding rect.
  const w = Number.parseFloat(svg.getAttribute("width") ?? "");
  const h = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const rect = svg.getBoundingClientRect();
  return {
    width: rect.width || 800,
    height: rect.height || 600,
  };
}

export async function exportSvg(svg: SVGSVGElement, filename = "erd.svg"): Promise<void> {
  const xml = serializeSvg(svg);
  const blob = new Blob([xml], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(
  svg: SVGSVGElement,
  filename = "erd.png",
  scale = 2,
): Promise<void> {
  const xml = serializeSvg(svg);
  const { width, height } = readSvgPixelSize(svg);
  // Use base64-encoded data URL — browsers refuse some embedded fonts /
  // foreign chars when the URL is just URI-encoded.
  const base64 = btoa(unescape(encodeURIComponent(xml)));
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load SVG into Image"));
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Canvas toBlob returned null"));
    }, "image/png");
  });

  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}
