/**
 * — exporters (C4) tests.
 *
 * jsdom does not implement Image decode / OffscreenCanvas pixel paths,
 * so we cover the structural contract here:
 * - exportSvg builds a Blob whose first 5 bytes are `<svg ` and
 * triggers a download via URL.createObjectURL → anchor click.
 * - exportPng kicks off the rasterization pipeline (creates an Image
 * and a canvas), and resolves once the pipeline completes. Pixel
 * fidelity is asserted by Playwright in Phase 3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportPng, exportSvg } from "./exporters";

let createdObjectUrls: Blob[] = [];
let revokedUrls: string[] = [];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

function makeSvg(width = 100, height = 60): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // A trivial child so XMLSerializer has something to serialize.
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  svg.appendChild(rect);
  document.body.appendChild(svg);
  return svg;
}

beforeEach(() => {
  createdObjectUrls = [];
  revokedUrls = [];
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    createdObjectUrls.push(b as Blob);
    return "blob:mock-url";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((u: string) => {
    revokedUrls.push(u);
  }) as typeof URL.revokeObjectURL;
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  document.body.innerHTML = "";
});

async function readBlobText(blob: Blob): Promise<string> {
  // jsdom's Blob lacks .text(); fall back to FileReader.
  if (typeof blob.text === "function") return blob.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("exportSvg", () => {
  it("creates an SVG blob whose first 4 bytes are '<svg'", async () => {
    const svg = makeSvg();
    // Stub anchor.click to avoid jsdom's "Not implemented: navigation" warning.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await exportSvg(svg, "diagram.svg");
    } finally {
      clickSpy.mockRestore();
    }
    expect(createdObjectUrls).toHaveLength(1);
    const blob = createdObjectUrls[0];
    expect(blob.type).toBe("image/svg+xml");
    const text = await readBlobText(blob);
    expect(text.slice(0, 4)).toBe("<svg");
  });

  it("revokes the object URL after triggering download", async () => {
    const svg = makeSvg();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await exportSvg(svg);
    } finally {
      clickSpy.mockRestore();
    }
    expect(revokedUrls).toHaveLength(1);
    expect(revokedUrls[0]).toBe("blob:mock-url");
  });
});

describe("exportPng", () => {
  it("resolves and creates at least one object URL", async () => {
    const svg = makeSvg(80, 40);

    // Stub Image so onload fires synchronously.
    class StubImage {
      onload: (() => void) | null = null;
      onerror: ((err: unknown) => void) | null = null;
      width = 80;
      height = 40;
      private _src = "";
      get src(): string {
        return this._src;
      }
      set src(value: string) {
        this._src = value;
        // Fire onload on the next microtask to mimic real Image behavior.
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", StubImage);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    // Stub canvas.toBlob to return a fake PNG blob.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvasProto = HTMLCanvasElement.prototype as any;
    const origToBlob = canvasProto.toBlob;
    const origGetContext = canvasProto.getContext;
    canvasProto.toBlob = (cb: (b: Blob | null) => void) => {
      cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
    };
    canvasProto.getContext = () => ({
      drawImage: () => {},
      clearRect: () => {},
    });

    try {
      await exportPng(svg, "diagram.png", 2);
      // exportSvg-style data URL is created internally to feed the Image; the
      // final PNG-blob anchor download is what we care about.
      expect(createdObjectUrls.length).toBeGreaterThan(0);
      const last = createdObjectUrls[createdObjectUrls.length - 1];
      expect(last.type).toBe("image/png");
    } finally {
      canvasProto.toBlob = origToBlob;
      canvasProto.getContext = origGetContext;
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
