import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ErdColumn } from "../../lib/tauri";
import { TableCard } from "./TableCard";
import type { LaidErdNode } from "./layout";
import { MAX_VISIBLE_COLS } from "./layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Mock returns the raw key plus a JSON-ish trailer of the
      // interpolation values so tests can match either piece.
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
    x: 10,
    y: 20,
    width: 240,
    height: 200,
  };
}

function renderInSvg(content: React.ReactNode) {
  return render(    <svg>
      <title>test</title>
      {content}
    </svg>,
);
}

describe("TableCard", () => {
  test("renders schema and table name", () => {
    const node = makeNode([makeColumn("id", 1, { isPrimaryKey: true, nullable: false })]);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    expect(container.textContent).toContain("public");
    expect(container.textContent).toContain("users");
  });

  test("attaches data-testid and data-table-id matching node id", () => {
    const node = makeNode([makeColumn("id", 1, { isPrimaryKey: true })]);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    const card = container.querySelector("[data-testid='erd-table-card']");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("data-table-id")).toBe("public.users");
  });

  test("renders one row per column up to MAX_VISIBLE_COLS, with footer above", () => {
    const cols = Array.from({ length: MAX_VISIBLE_COLS + 5 }, (_, i) =>
      makeColumn(`col_${i}`, i + 1),
);
    const node = makeNode(cols);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    const rows = container.querySelectorAll("[data-testid='erd-column-row']");
    expect(rows.length).toBe(MAX_VISIBLE_COLS);
    const footer = container.querySelector("[data-testid='erd-column-overflow']");
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain("5");
  });

  test("does not render footer when columns <= MAX_VISIBLE_COLS", () => {
    const cols = Array.from({ length: 4 }, (_, i) => makeColumn(`c_${i}`, i + 1));
    const node = makeNode(cols);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    expect(container.querySelector("[data-testid='erd-column-overflow']")).toBeNull();
  });

  test("PK column has a badge labelled 'erd.node.pk_aria'", () => {
    const node = makeNode([
      makeColumn("id", 1, { isPrimaryKey: true, nullable: false, dataType: "uuid" }),
      makeColumn("email", 2),
    ]);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    const pk = container.querySelector("[data-testid='erd-pk-badge']");
    expect(pk).not.toBeNull();
    expect(pk?.getAttribute("aria-label")).toContain("erd.node.pk_aria");
  });

  test("FK column has a badge labelled 'erd.node.fk_aria'", () => {
    const node = makeNode([makeColumn("user_id", 1, { isForeignKey: true })]);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    const fk = container.querySelector("[data-testid='erd-fk-badge']");
    expect(fk).not.toBeNull();
    expect(fk?.getAttribute("aria-label")).toContain("erd.node.fk_aria");
  });

  test("highlighted card uses accent stroke", () => {
    const node = makeNode([makeColumn("id", 1, { isPrimaryKey: true })]);
    const { container } = renderInSvg(<TableCard node={node} highlighted={true} />);
    const rect = container.querySelector("[data-testid='erd-table-card'] rect");
    expect(rect?.getAttribute("stroke")).toBe("var(--accent)");
  });

  test("non-highlighted card uses hairline stroke", () => {
    const node = makeNode([makeColumn("id", 1, { isPrimaryKey: true })]);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    const rect = container.querySelector("[data-testid='erd-table-card'] rect");
    expect(rect?.getAttribute("stroke")).toBe("var(--hairline)");
  });

  test("regression: uses defined design tokens (no --surface-1 / --ink-1)", () => {
    // The tokens `--surface-1` and `--ink-1` are NOT defined in
    // src/styles/tokens.css / design.css; the project uses `--surface`,
    // `--bg-elev`, `--ink`, `--ink-2`, etc. 's first draft
    // referenced the undefined tokens and the cards rendered as black
    // panels with invisible text. This test asserts the SVG never
    // mentions `--surface-1` or `--ink-1`.
    const node = makeNode([
      makeColumn("id", 1, { isPrimaryKey: true, nullable: false }),
      makeColumn("name", 2),
    ]);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    const svg = container.querySelector("svg");
    const html = svg?.innerHTML ?? "";
    expect(html).not.toContain("--surface-1");
    expect(html).not.toContain("--ink-1)");
  });

  test("aria-label is composed via the localized erd.node.card_aria key", () => {
    // post-QA: the card aria-label now flows through i18n
    // () rather than being a hardcoded English string. Under
    // the passthrough mock the key + interpolation values are appended,
    // so we assert the key is present and the schema/table/counts are
    // captured.
    const node = makeNode([
      makeColumn("id", 1, { isPrimaryKey: true, nullable: false }),
      makeColumn("user_id", 2, { isForeignKey: true }),
      makeColumn("note", 3),
    ]);
    const { container } = renderInSvg(<TableCard node={node} highlighted={false} />);
    const card = container.querySelector("[data-testid='erd-table-card']");
    const label = card?.getAttribute("aria-label") ?? "";
    expect(label).toContain("erd.node.card_aria");
    expect(label).toContain("schema=public");
    expect(label).toContain("table=users");
    expect(label).toContain("columnCount=3");
    expect(label).toContain("pkCount=1");
    expect(label).toContain("fkCount=1");
  });
});
