import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ErdColumn } from "../../lib/tauri";
import { TableCard } from "./TableCard";
import type { LaidErdNode } from "./layout";

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

function makeColumn(name: string, ordinal: number, overrides: Partial<ErdColumn> = {}): ErdColumn {
  return {
    name,
    dataType: overrides.dataType ?? "text",
    nullable: overrides.nullable ?? true,
    isPrimaryKey: overrides.isPrimaryKey ?? false,
    isForeignKey: overrides.isForeignKey ?? false,
    ordinal,
  };
}

function makeNode(columns: ErdColumn[]): LaidErdNode {
  return {
    id: "public.users",
    schema: "public",
    name: "users",
    columns,
    x: 0,
    y: 0,
    width: 240,
    height: 80,
  };
}

describe("TableCard editable mode", () => {
  it("renders InlineEditor on header in edit mode", () => {
    const node = makeNode([
      makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "bigint" }),
    ]);
    render(      <svg>
        <title>test</title>
        <TableCard
          node={node}
          highlighted={false}
          onFocus={() => {}}
          editable
          onRenameTable={() => {}}
        />
      </svg>,
);
    fireEvent.click(screen.getByText("users"));
    expect(screen.getByRole("textbox")).toHaveValue("users");
  });

  it("renders + Add column row when editable", () => {
    const node = makeNode([
      makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "bigint" }),
    ]);
    render(      <svg>
        <title>test</title>
        <TableCard
          node={node}
          highlighted={false}
          onFocus={() => {}}
          editable
          onAddColumn={() => {}}
        />
      </svg>,
);
    expect(screen.getByTestId("table-card-add-column")).toBeInTheDocument();
  });

  it("drop-target sets data-state attr", () => {
    const node = makeNode([
      makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "bigint" }),
    ]);
    render(      <svg>
        <title>test</title>
        <TableCard node={node} highlighted={false} onFocus={() => {}} editable isDropTarget />
      </svg>,
);
    expect(screen.getByTestId(`erd-card-${node.id}`)).toHaveAttribute("data-state", "drop-target");
  });

  it("clicking +Add column triggers onAddColumn", () => {
    const node = makeNode([
      makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "bigint" }),
    ]);
    const onAddColumn = vi.fn();
    render(      <svg>
        <title>test</title>
        <TableCard
          node={node}
          highlighted={false}
          onFocus={() => {}}
          editable
          onAddColumn={onAddColumn}
        />
      </svg>,
);
    fireEvent.click(screen.getByTestId("table-card-add-column"));
    expect(onAddColumn).toHaveBeenCalled();
  });

  it("FK link handle calls onStartFkDrag on mouseDown", () => {
    const node = makeNode([
      makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "bigint" }),
    ]);
    const onStartFkDrag = vi.fn();
    render(      <svg>
        <title>test</title>
        <TableCard
          node={node}
          highlighted={false}
          onFocus={() => {}}
          editable
          onStartFkDrag={onStartFkDrag}
        />
      </svg>,
);
    fireEvent.mouseDown(screen.getByTestId("table-card-fk-handle"));
    expect(onStartFkDrag).toHaveBeenCalled();
  });
});
