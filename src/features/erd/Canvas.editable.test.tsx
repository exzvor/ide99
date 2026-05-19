import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Canvas } from "./Canvas";
import type { LaidErd, LaidErdNode } from "./layout";

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

function makeLaid(nodes: LaidErdNode[]): LaidErd {
  return { nodes, edges: [], width: 800, height: 600, layoutMs: 5 };
}

describe("Canvas editable mode", () => {
  test("mode=edit propagates editable=true to TableCard", () => {
    const laid = makeLaid([makeNode("public.a")]);
    const { container } = render(      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
        mode="edit"
      />,
);
    // Editable TableCard uses `erd-card-${id}` testid; read-mode uses `erd-table-card`.
    expect(container.querySelector("[data-testid='erd-card-public.a']")).not.toBeNull();
    expect(container.querySelector("[data-testid='erd-table-card']")).toBeNull();
  });

  test("mode=read keeps existing TableCard testid", () => {
    const laid = makeLaid([makeNode("public.a")]);
    const { container } = render(      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
        mode="read"
      />,
);
    expect(container.querySelector("[data-testid='erd-table-card']")).not.toBeNull();
  });

  test("dragging a table in edit mode dispatches onTableDragMove + onTableDragEnd", () => {
    const onTableDragMove = vi.fn();
    const onTableDragEnd = vi.fn();
    const laid = makeLaid([makeNode("public.a", 0, 0)]);
    const { container } = render(      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
        mode="edit"
        onTableDragMove={onTableDragMove}
        onTableDragEnd={onTableDragEnd}
      />,
);
    const card = container.querySelector("[data-testid='erd-card-public.a']");
    if (!card) throw new Error("missing card");
    fireEvent.mouseDown(card, { clientX: 50, clientY: 50, button: 0 });
    const svg = container.querySelector("[data-testid='erd-canvas']");
    if (!svg) throw new Error("missing svg");
    fireEvent.mouseMove(svg, { clientX: 80, clientY: 70 });
    expect(onTableDragMove).toHaveBeenCalled();
    expect(onTableDragMove.mock.calls[0][0]).toBe("public.a");
    fireEvent.mouseUp(svg, { clientX: 80, clientY: 70 });
    expect(onTableDragEnd).toHaveBeenCalled();
    expect(onTableDragEnd.mock.calls[0][0]).toBe("public.a");
  });

  test("FK link-handle mouseDown fires onFkDragStart with source id", () => {
    const onFkDragStart = vi.fn();
    const onFkDragEnd = vi.fn();
    const laid = makeLaid([makeNode("public.a"), makeNode("public.b", 300)]);
    const { container } = render(      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
        mode="edit"
        onFkDragStart={onFkDragStart}
        onFkDragEnd={onFkDragEnd}
      />,
);
    const handles = container.querySelectorAll("[data-testid='table-card-fk-handle']");
    expect(handles.length).toBe(2);
    fireEvent.mouseDown(handles[0]);
    expect(onFkDragStart).toHaveBeenCalledWith("public.a");
    const svg = container.querySelector("[data-testid='erd-canvas']");
    if (!svg) throw new Error("missing svg");
    fireEvent.mouseUp(svg);
    expect(onFkDragEnd).toHaveBeenCalled();
  });

  test("does not start table-drag in read mode", () => {
    const onTableDragMove = vi.fn();
    const laid = makeLaid([makeNode("public.a")]);
    const { container } = render(      <Canvas
        laid={laid}
        highlight={{ nodeId: null, edgeId: null }}
        onNodeFocus={() => {}}
        panX={0}
        panY={0}
        zoom={1}
        mode="read"
        onTableDragMove={onTableDragMove}
      />,
);
    const card = container.querySelector("[data-testid='erd-table-card']");
    if (!card) throw new Error("missing card");
    fireEvent.mouseDown(card, { clientX: 50, clientY: 50, button: 0 });
    const svg = container.querySelector("[data-testid='erd-canvas']");
    if (!svg) throw new Error("missing svg");
    fireEvent.mouseMove(svg, { clientX: 80, clientY: 70 });
    expect(onTableDragMove).not.toHaveBeenCalled();
  });
});
