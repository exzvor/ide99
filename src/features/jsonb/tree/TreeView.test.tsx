import "../../../i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TreeView } from "./TreeView";

beforeAll(() => {
  // jsdom doesn't lay out flex/overflow regions, so @tanstack/react-virtual
  // reports a 0-height scroll element and renders zero items. Patch
  // getBoundingClientRect to claim a reasonable viewport size.
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      } as DOMRect;
    },
  });
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverPolyfill {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverPolyfill }).ResizeObserver =
      ResizeObserverPolyfill;
  }
});

describe("TreeView — render", () => {
  it("renders root container with children expanded by default", () => {
    render(
      <TreeView
        value={{ a: 1, b: { c: 2 } }}
        onChange={() => {}}
        readOnly={false}
        isJsonbType={false}
      />,
    );
    const items = screen.getAllByRole("treeitem");
    // root + a + b (b's children rendered only when b expanded — collapsed by default)
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  it("clicking chevron on a child container expands it", () => {
    render(
      <TreeView
        value={{ outer: { inner: 1 } }}
        onChange={() => {}}
        readOnly={false}
        isJsonbType={false}
      />,
    );
    // Initially `outer` is collapsed → only root + outer rendered.
    expect(screen.queryByText("inner")).toBeNull();
    const chevrons = screen.getAllByTestId("jsonb-tree-chevron");
    // [0] is root (already expanded), [1] is outer
    fireEvent.click(chevrons[1] as Element);
    expect(screen.getByText("inner")).toBeInTheDocument();
  });

  it("editing a leaf value calls onChange with the immutable next value", () => {
    const onChange = vi.fn();
    render(
      <TreeView
        value={{ a: 1, b: "hi" }}
        onChange={onChange}
        readOnly={false}
        isJsonbType={false}
      />,
    );
    const leaves = screen.getAllByTestId("jsonb-tree-leaf-value");
    // First leaf is "a: 1"; click and edit.
    fireEvent.click(leaves[0] as Element);
    const input = screen.getByTestId("jsonb-tree-leaf-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ a: 9, b: "hi" });
  });

  it("add-key on root object appends a new key", () => {
    const onChange = vi.fn();
    render(<TreeView value={{ a: 1 }} onChange={onChange} readOnly={false} isJsonbType={false} />);
    const addButtons = screen.getAllByTestId("jsonb-tree-add-child");
    // Root's add-child button is the first.
    fireEvent.click(addButtons[0] as Element);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(next).length).toBe(2);
    expect(next.a).toBe(1);
  });

  it("delete on a child removes it from the parent (no confirm in pure component)", () => {
    const onChange = vi.fn();
    render(
      <TreeView value={{ a: 1, b: 2 }} onChange={onChange} readOnly={false} isJsonbType={false} />,
    );
    const deletes = screen.getAllByTestId("jsonb-tree-delete");
    fireEvent.click(deletes[0] as Element);
    expect(onChange).toHaveBeenCalledWith({ b: 2 });
  });

  it("add-item on root array pushes null", () => {
    const onChange = vi.fn();
    render(<TreeView value={[1, 2]} onChange={onChange} readOnly={false} isJsonbType={false} />);
    const addButtons = screen.getAllByTestId("jsonb-tree-add-child");
    fireEvent.click(addButtons[0] as Element);
    expect(onChange).toHaveBeenCalledWith([1, 2, null]);
  });

  it("scalar root renders a single leaf node labelled (root)", () => {
    render(<TreeView value={"hello"} onChange={() => {}} readOnly={false} isJsonbType={false} />);
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
    expect(screen.getByText("(root)")).toBeInTheDocument();
  });
});

describe("TreeView — canonical note", () => {
  it("shows the inline note when isJsonbType=true", () => {
    render(<TreeView value={{ a: 1 }} onChange={() => {}} readOnly={false} isJsonbType={true} />);
    expect(screen.getByTestId("jsonb-tree-canonical-note")).toBeInTheDocument();
  });

  it("hides the inline note when isJsonbType=false", () => {
    render(<TreeView value={{ a: 1 }} onChange={() => {}} readOnly={false} isJsonbType={false} />);
    expect(screen.queryByTestId("jsonb-tree-canonical-note")).toBeNull();
  });

  it("dismiss button removes the note", () => {
    render(<TreeView value={{ a: 1 }} onChange={() => {}} readOnly={false} isJsonbType={true} />);
    const note = screen.getByTestId("jsonb-tree-canonical-note");
    fireEvent.click(note.querySelector("button") as Element);
    expect(screen.queryByTestId("jsonb-tree-canonical-note")).toBeNull();
  });
});

describe("TreeView — readOnly", () => {
  it("hides edit affordances when readOnly", () => {
    render(<TreeView value={{ a: 1, b: 2 }} onChange={() => {}} readOnly isJsonbType={false} />);
    expect(screen.queryByTestId("jsonb-tree-add-child")).toBeNull();
    expect(screen.queryByTestId("jsonb-tree-delete")).toBeNull();
    expect(screen.queryByTestId("jsonb-tree-drag-handle")).toBeNull();
  });
});

describe("TreeView — virtualization", () => {
  it("uses TanStack Virtual when visible nodes > 200, rendering <300 DOM nodes", () => {
    // 250 array items at root → flatten = root + 250 = 251 nodes.
    const big = Array.from({ length: 250 }, (_, i) => i);
    const { container } = render(
      <TreeView value={big} onChange={() => {}} readOnly={false} isJsonbType={false} />,
    );
    // Virtualized rows have a unique testid; with overscan=8 only a small
    // subset should be in the DOM. Assert that the virtualization codepath is
    // active and that the rendered row count is far below the dataset.
    const virtualRows = container.querySelectorAll('[data-testid="jsonb-tree-virtual-row"]');
    expect(virtualRows.length).toBeGreaterThan(0);
    expect(virtualRows.length).toBeLessThan(50);
  });

  it("renders all rows inline when count <= 200", () => {
    const small = Array.from({ length: 5 }, (_, i) => i);
    const { container } = render(
      <TreeView value={small} onChange={() => {}} readOnly={false} isJsonbType={false} />,
    );
    const virtualRows = container.querySelectorAll('[data-testid="jsonb-tree-virtual-row"]');
    expect(virtualRows.length).toBe(0);
    // root + 5 children
    expect(screen.getAllByRole("treeitem").length).toBe(6);
  });
});
