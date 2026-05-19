import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ColumnMeta } from "../../lib/tauri";
import { Cell } from "./Cell";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const COL = (overrides: Partial<ColumnMeta>): ColumnMeta => ({
  name: "x",
  typeName: "text",
  isNumeric: false,
  ...overrides,
});

describe("Cell typed dispatch", () => {
  test("NULL value renders italic gray 'NULL'", () => {
    render(<Cell column={COL({})} value={null} />);
    const el = screen.getByText("NULL");
    expect(el).toHaveClass("cell-null");
  });

  test("bool value renders true/false plain", () => {
    render(<Cell column={COL({ typeName: "bool" })} value="true" />);
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  test("numeric value gets numeric class", () => {
    render(<Cell column={COL({ typeName: "int4", isNumeric: true })} value="42" />);
    const el = screen.getByText("42");
    expect(el).toHaveClass("cell-numeric");
  });

  test("json value uses JsonCell (monospace)", () => {
    render(<Cell column={COL({ typeName: "jsonb" })} value='{"a":1}' />);
    expect(screen.getByText('{"a":1}')).toHaveClass("font-mono");
  });

  test("plain text renders truncated with full title attribute", () => {
    const long = "a".repeat(500);
    render(<Cell column={COL({ typeName: "text" })} value={long} />);
    const el = screen.getByText(long);
    expect(el).toHaveAttribute("title", long);
  });

  test("S27 — geometry value renders <GeometryCellSvg>", () => {
    // POINT(1, 2) SRID 4326 — well-formed EWKB hex from PostGIS.
    render(
      <Cell
        column={COL({ typeName: "geometry(Point,4326)" })}
        value="0101000020E6100000000000000000F03F0000000000000040"
      />,
    );
    expect(screen.getByTestId("geom-cell-svg")).toBeInTheDocument();
  });

  test("S27 — geography column also routes to <GeometryCellSvg>", () => {
    render(
      <Cell
        column={COL({ typeName: "geography(Polygon,4326)" })}
        value="0101000020E6100000000000000000F03F0000000000000040"
      />,
    );
    expect(screen.getByTestId("geom-cell-svg")).toBeInTheDocument();
  });
});
