import "../../../i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Node } from "./Node";

function defaults(overrides: Partial<React.ComponentProps<typeof Node>> = {}) {
  return {
    path: [] as string[],
    keyOrIndex: "(root)",
    value: { a: 1 } as unknown,
    level: 0,
    parentIsArray: false,
    hasChildren: true,
    expanded: true,
    setSize: 1,
    posInSet: 1,
    readOnly: false,
    isRoot: true,
    onToggleExpand: vi.fn(),
    onMutate: vi.fn(),
    onDelete: vi.fn(),
    onAddChild: vi.fn(),
    ...overrides,
  };
}

describe("Node — ARIA", () => {
  it("sets role=treeitem with aria-level/posinset/setsize", () => {
    render(<Node {...defaults({ level: 2, posInSet: 3, setSize: 5 })} />);
    const item = screen.getByRole("treeitem");
    expect(item).toHaveAttribute("aria-level", "3");
    expect(item).toHaveAttribute("aria-posinset", "3");
    expect(item).toHaveAttribute("aria-setsize", "5");
  });

  it("aria-expanded reflects expanded prop for containers", () => {
    const { rerender } = render(<Node {...defaults({ expanded: true })} />);
    expect(screen.getByRole("treeitem")).toHaveAttribute("aria-expanded", "true");
    rerender(<Node {...defaults({ expanded: false })} />);
    expect(screen.getByRole("treeitem")).toHaveAttribute("aria-expanded", "false");
  });

  it("omits aria-expanded for leaf nodes", () => {
    render(      <Node {...defaults({ value: 42, hasChildren: false, isRoot: false, keyOrIndex: "n" })} />,
);
    expect(screen.getByRole("treeitem")).not.toHaveAttribute("aria-expanded");
  });
});

describe("Node — interactions", () => {
  it("clicking chevron calls onToggleExpand with the path", () => {
    const onToggleExpand = vi.fn();
    render(      <Node {...defaults({ path: ["a"], hasChildren: true, expanded: true, onToggleExpand })} />,
);
    fireEvent.click(screen.getByTestId("jsonb-tree-chevron"));
    expect(onToggleExpand).toHaveBeenCalledWith(["a"]);
  });

  it("clicking leaf value reveals an editor; commit calls onMutate", () => {
    const onMutate = vi.fn();
    render(      <Node
        {...defaults({
          value: "hi",
          hasChildren: false,
          isRoot: false,
          keyOrIndex: "name",
          path: ["name"],
          onMutate,
        })}
      />,
);
    fireEvent.click(screen.getByTestId("jsonb-tree-leaf-value"));
    const input = screen.getByTestId("jsonb-tree-leaf-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bye" } });
    fireEvent.blur(input);
    expect(onMutate).toHaveBeenCalledWith(["name"], "bye");
  });

  it("number input rejects non-numeric and does not call onMutate", () => {
    const onMutate = vi.fn();
    render(      <Node
        {...defaults({
          value: 7,
          hasChildren: false,
          isRoot: false,
          keyOrIndex: "n",
          path: ["n"],
          onMutate,
        })}
      />,
);
    fireEvent.click(screen.getByTestId("jsonb-tree-leaf-value"));
    const input = screen.getByTestId("jsonb-tree-leaf-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("boolean leaf renders a select with true/false options", () => {
    const onMutate = vi.fn();
    render(      <Node
        {...defaults({
          value: true,
          hasChildren: false,
          isRoot: false,
          keyOrIndex: "b",
          path: ["b"],
          onMutate,
        })}
      />,
);
    fireEvent.click(screen.getByTestId("jsonb-tree-leaf-value"));
    const select = screen.getByTestId("jsonb-tree-leaf-input") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "false" } });
    fireEvent.blur(select);
    expect(onMutate).toHaveBeenCalledWith(["b"], false);
  });

  it("null leaf shows [set value] button", () => {
    render(      <Node
        {...defaults({
          value: null,
          hasChildren: false,
          isRoot: false,
          keyOrIndex: "x",
          path: ["x"],
        })}
      />,
);
    fireEvent.click(screen.getByTestId("jsonb-tree-leaf-value"));
    expect(screen.getByTestId("leaf-set-value")).toBeInTheDocument();
  });

  it("delete button calls onDelete with the path (non-root only)", () => {
    const onDelete = vi.fn();
    render(      <Node
        {...defaults({
          value: 1,
          hasChildren: false,
          isRoot: false,
          keyOrIndex: "k",
          path: ["k"],
          onDelete,
        })}
      />,
);
    fireEvent.click(screen.getByTestId("jsonb-tree-delete"));
    expect(onDelete).toHaveBeenCalledWith(["k"]);
  });

  it("add-child button calls onAddChild for object containers", () => {
    const onAddChild = vi.fn();
    render(<Node {...defaults({ value: { a: 1 }, onAddChild })} />);
    fireEvent.click(screen.getByTestId("jsonb-tree-add-child"));
    expect(onAddChild).toHaveBeenCalledWith([], "key");
  });

  it("add-child button calls onAddChild for array containers", () => {
    const onAddChild = vi.fn();
    render(<Node {...defaults({ value: [1, 2], onAddChild })} />);
    fireEvent.click(screen.getByTestId("jsonb-tree-add-child"));
    expect(onAddChild).toHaveBeenCalledWith([], "item");
  });
});

describe("Node — readOnly", () => {
  it("hides delete and add-child buttons when readOnly", () => {
    render(      <Node
        {...defaults({
          readOnly: true,
          value: 1,
          hasChildren: false,
          isRoot: false,
          keyOrIndex: "k",
          path: ["k"],
        })}
      />,
);
    expect(screen.queryByTestId("jsonb-tree-delete")).toBeNull();
    expect(screen.queryByTestId("jsonb-tree-add-child")).toBeNull();
  });

  it("disables the leaf-value button when readOnly", () => {
    render(      <Node
        {...defaults({
          readOnly: true,
          value: "hi",
          hasChildren: false,
          isRoot: false,
          keyOrIndex: "k",
          path: ["k"],
        })}
      />,
);
    expect(screen.getByTestId("jsonb-tree-leaf-value")).toBeDisabled();
  });
});

describe("Node — type badge", () => {
  it("shows the array length in the badge", () => {
    render(      <Node
        {...defaults({
          value: [1, 2, 3],
          hasChildren: true,
          expanded: false,
          isRoot: false,
          keyOrIndex: "xs",
          path: ["xs"],
        })}
      />,
);
    expect(screen.getByTestId("jsonb-tree-type-badge")).toHaveTextContent("3");
  });
});
