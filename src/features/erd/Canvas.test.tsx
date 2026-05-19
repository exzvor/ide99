import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Canvas } from "./Canvas";
import type { LaidErd, LaidErdEdge, LaidErdNode } from "./layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        const trailer = Object.entries(opts)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",");
        return `${key} ${trailer}`;
      }
      return key;
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

function makeNode(id: string, x = 0, y = 0): LaidErdNode {
  return {
    id,
    schema: id.split(".")[0] ?? "public",
    name: id.split(".")[1] ?? "t",
    columns: [
      {
        name: "id",
        dataType: "uuid",
        nullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
        ordinal: 1,
      },
    ],
    x,
    y,
    width: 240,
    height: 60,
  };
}

function makeEdge(id: string, from: string, to: string): LaidErdEdge {
  return {
    id,
    fromNodeId: from,
    toNodeId: to,
    d: "M 0 0 L 100 100",
    fromColumns: ["id"],
    toColumns: ["id"],
  };
}

function makeLaid(nodes: LaidErdNode[], edges: LaidErdEdge[]): LaidErd {
  return { nodes, edges, width: 800, height: 600, layoutMs: 5 };
}

describe("Canvas", () => {
  test("renders one card per node and one path per edge", () => {
    const laid = makeLaid(
      [makeNode("public.a"), makeNode("public.b", 300)],
      [makeEdge("fk1:public.a->public.b", "public.a", "public.b")],
    );
    const { container } = render(
      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
      />,
    );
    expect(container.querySelectorAll("[data-testid='erd-table-card']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-testid='erd-fk-edge']")).toHaveLength(1);
  });

  test("regression: aria-label flows through i18n", () => {
    const laid = makeLaid([], []);
    const { container } = render(
      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
      />,
    );
    const svg = container.querySelector("[data-testid='erd-canvas']");
    // Under the passthrough i18n mock the key itself is the value.
    expect(svg?.getAttribute("aria-label")).toContain("erd.canvas.aria_label");
  });

  test("renders width=100% and height=100% with no viewBox (1 SVG unit = 1 CSS px)", () => {
    // post-QA: dropping viewBox keeps pan/zoom math in a single
    // coordinate space (CSS px). An earlier draft scaled the viewBox to
    // the laid graph, which made `e.clientX - rect.left` (CSS) and
    // `translate(panX panY)` (SVG) drift relative to each other.
    const laid = makeLaid([makeNode("public.a")], []);
    const { container } = render(
      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
      />,
    );
    const svg = container.querySelector("[data-testid='erd-canvas']");
    expect(svg?.getAttribute("viewBox")).toBeNull();
    expect(svg?.getAttribute("width")).toBe("100%");
    expect(svg?.getAttribute("height")).toBe("100%");
  });

  test("inner group transform reflects panX, panY, zoom", () => {
    const laid = makeLaid([makeNode("public.a")], []);
    const { container } = render(
      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={50}
        panY={-30}
        zoom={1.5}
      />,
    );
    const inner = container.querySelector("[data-testid='erd-canvas-inner']");
    expect(inner?.getAttribute("transform")).toBe("translate(50 -30) scale(1.5)");
  });

  test("empty laid renders an SVG with marker defs but no node/edge children", () => {
    const laid = makeLaid([], []);
    const { container } = render(
      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
      />,
    );
    expect(container.querySelector("[data-testid='erd-canvas']")).not.toBeNull();
    expect(container.querySelector("#erd-arrow")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid='erd-table-card']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-testid='erd-fk-edge']")).toHaveLength(0);
  });

  test("forwards wheel/mouse handlers to the SVG element", () => {
    const onWheel = vi.fn();
    const onMouseDown = vi.fn();
    const onMouseMove = vi.fn();
    const onMouseUp = vi.fn();
    const laid = makeLaid([makeNode("public.a")], []);
    const { container } = render(
      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />,
    );
    const svg = container.querySelector("[data-testid='erd-canvas']");
    if (!svg) throw new Error("missing svg");
    fireEvent.wheel(svg);
    fireEvent.mouseDown(svg);
    fireEvent.mouseMove(svg);
    fireEvent.mouseUp(svg);
    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(onMouseMove).toHaveBeenCalledTimes(1);
    expect(onMouseUp).toHaveBeenCalledTimes(1);
  });

  test("calls onNodeFocus when a card receives focus", () => {
    const onNodeFocus = vi.fn();
    const laid = makeLaid([makeNode("public.a")], []);
    const { container } = render(
      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={onNodeFocus}
        panX={0}
        panY={0}
        zoom={1}
      />,
    );
    const card = container.querySelector("[data-testid='erd-table-card']");
    if (!card) throw new Error("missing card");
    fireEvent.focus(card);
    expect(onNodeFocus).toHaveBeenCalledWith("public.a");
  });

  test("highlighted node and edge get accent stroke", () => {
    const laid = makeLaid(
      [makeNode("public.a"), makeNode("public.b", 300)],
      [makeEdge("fk1:public.a->public.b", "public.a", "public.b")],
    );
    const { container } = render(
      <Canvas
        laid={laid}
        highlight={{ nodeId: "public.a", edgeId: "fk1:public.a->public.b" }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
      />,
    );
    const cardA = container.querySelector(
      "[data-testid='erd-table-card'][data-table-id='public.a'] rect",
    );
    expect(cardA?.getAttribute("stroke")).toBe("var(--accent)");
    const edgePath = container.querySelector("[data-testid='erd-fk-edge'] path");
    expect(edgePath?.getAttribute("stroke")).toBe("var(--accent)");
  });
});
