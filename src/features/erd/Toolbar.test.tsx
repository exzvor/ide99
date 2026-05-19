/**
 * — ERD Toolbar (C3) tests.
 *
 * Covers:
 * - Schema dropdown options reflect distinct schemas + an "All schemas" sentinel.
 * - Picking a schema → setErdTabSchemas(tabId, [schema]).
 * - Picking "All schemas" → setErdTabSchemas(tabId, undefined).
 * - Each zoom button click invokes the matching prop callback.
 * - Export menu items dispatch exportPng / exportSvg respectively.
 * - axe: zero violations.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErdSchemaGraph } from "../../lib/tauri";

expect.extend(toHaveNoViolations);

// ─── Mocks ───────────────────────────────────────────────────────────────────

// A tiny fake dictionary so the stats string can be asserted on.
const FAKE_DICT: Record<string, string> = {
  "erd.toolbar.stats": "{{tableCount}} tables · {{fkCount}} FKs · laid out in {{layoutMs}} ms",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const template = FAKE_DICT[key] ?? key;
      if (!vars) return template;
      return Object.entries(vars).reduce<string>((acc, [k, v]) => {
        return acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
      }, template);
    },
  }),
}));

const mockSetErdTabSchemas = vi.fn();
vi.mock("../editor/store", () => ({
  useEditor: {
    getState: () => ({ setErdTabSchemas: mockSetErdTabSchemas }),
  },
}));

const mockExportPng = vi.fn().mockResolvedValue(undefined);
const mockExportSvg = vi.fn().mockResolvedValue(undefined);
vi.mock("./exporters", () => ({
  exportPng: (...args: unknown[]) => mockExportPng(...args),
  exportSvg: (...args: unknown[]) => mockExportSvg(...args),
}));

import { Toolbar } from "./Toolbar";

// Radix needs these jsdom polyfills.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  mockSetErdTabSchemas.mockReset();
  mockExportPng.mockClear();
  mockExportSvg.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleGraph: ErdSchemaGraph = {
  tables: [
    { schema: "public", name: "users", columns: [] },
    { schema: "public", name: "orders", columns: [] },
    { schema: "auth", name: "sessions", columns: [] },
  ],
  foreignKeys: [
    {
      name: "fk1",
      sourceSchema: "public",
      sourceTable: "orders",
      sourceColumns: ["user_id"],
      targetSchema: "public",
      targetTable: "users",
      targetColumns: ["id"],
    },
  ],
  fetchedInMs: 17,
};

function makeFakeSvg(): SVGSVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", "svg");
}

interface Stub {
  onZoomIn: ReturnType<typeof vi.fn>;
  onZoomOut: ReturnType<typeof vi.fn>;
  onZoomReset: ReturnType<typeof vi.fn>;
  onFit: ReturnType<typeof vi.fn>;
  svg: SVGSVGElement;
}

function makeStub(): Stub {
  return {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onFit: vi.fn(),
    svg: makeFakeSvg(),
  };
}

function renderToolbar(  props?: Partial<Stub & { selectedSchemas?: string[]; availableSchemas?: string[] }>,
) {
  const stub = makeStub();
  const { selectedSchemas, availableSchemas, ...rest } = props ?? {};
  return {
    stub,
    ...render(      <Toolbar
        tabId="tab-1"
        graph={sampleGraph}
        availableSchemas={availableSchemas ?? ["auth", "public", "sales"]}
        layoutMs={42.4}
        selectedSchemas={selectedSchemas}
        onZoomIn={rest.onZoomIn ?? stub.onZoomIn}
        onZoomOut={rest.onZoomOut ?? stub.onZoomOut}
        onZoomReset={rest.onZoomReset ?? stub.onZoomReset}
        onFit={rest.onFit ?? stub.onFit}
        getSvgEl={() => rest.svg ?? stub.svg}
      />,
),
  };
}

describe("Toolbar", () => {
  it("renders zoom + fit + export controls plus stats", () => {
    renderToolbar();
    expect(screen.getByTestId("erd-zoom-in")).toBeInTheDocument();
    expect(screen.getByTestId("erd-zoom-out")).toBeInTheDocument();
    expect(screen.getByTestId("erd-zoom-reset")).toBeInTheDocument();
    expect(screen.getByTestId("erd-fit")).toBeInTheDocument();
    expect(screen.getByTestId("erd-export-menu")).toBeInTheDocument();
    expect(screen.getByTestId("erd-schema-filter")).toBeInTheDocument();
    // Stats use t('erd.toolbar.stats', ...) — our mock substitutes vars in-place.
    expect(screen.getByText(/3 tables · 1 FKs · laid out in 42 ms/)).toBeInTheDocument();
  });

  it("zoom + fit buttons each call their prop callback once", async () => {
    const user = userEvent.setup();
    const { stub } = renderToolbar();

    await user.click(screen.getByTestId("erd-zoom-in"));
    expect(stub.onZoomIn).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("erd-zoom-out"));
    expect(stub.onZoomOut).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("erd-zoom-reset"));
    expect(stub.onZoomReset).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("erd-fit"));
    expect(stub.onFit).toHaveBeenCalledTimes(1);
  });

  it("schema dropdown lists distinct schemas and an All schemas option", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByTestId("erd-schema-filter");
    await user.click(trigger);
    // Options are rendered as Radix items in a portal.
    expect(screen.getByTestId("erd-schema-filter-option-all")).toBeInTheDocument();
    expect(screen.getByTestId("erd-schema-filter-option-auth")).toBeInTheDocument();
    expect(screen.getByTestId("erd-schema-filter-option-public")).toBeInTheDocument();
  });

  it("regression: dropdown shows all schemas even when graph is filtered to a single schema", async () => {
    // The user has filtered to "qa_s11" so the loaded `graph` only contains
    // that one schema. The toolbar dropdown MUST still expose every other
    // schema so the user can switch directly without first resetting to
    // "All schemas".
    const filteredGraph: ErdSchemaGraph = {
      tables: [{ schema: "qa_s11", name: "only_one", columns: [] }],
      foreignKeys: [],
      fetchedInMs: 5,
    };
    const user = userEvent.setup();
    render(      <Toolbar
        tabId="tab-1"
        graph={filteredGraph}
        availableSchemas={["auth", "perf", "public", "qa_s11", "sales"]}
        layoutMs={5}
        selectedSchemas={["qa_s11"]}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onZoomReset={() => {}}
        onFit={() => {}}
        getSvgEl={() => makeFakeSvg()}
      />,
);
    await user.click(screen.getByTestId("erd-schema-filter"));
    expect(screen.getByTestId("erd-schema-filter-option-public")).toBeInTheDocument();
    expect(screen.getByTestId("erd-schema-filter-option-sales")).toBeInTheDocument();
    expect(screen.getByTestId("erd-schema-filter-option-perf")).toBeInTheDocument();
    expect(screen.getByTestId("erd-schema-filter-option-auth")).toBeInTheDocument();
    expect(screen.getByTestId("erd-schema-filter-option-qa_s11")).toBeInTheDocument();
  });

  it("picking a schema calls setErdTabSchemas(tabId, [schema])", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByTestId("erd-schema-filter"));
    await user.click(screen.getByTestId("erd-schema-filter-option-public"));
    expect(mockSetErdTabSchemas).toHaveBeenCalledWith("tab-1", ["public"]);
  });

  it("picking All schemas calls setErdTabSchemas(tabId, undefined)", async () => {
    const user = userEvent.setup();
    renderToolbar({ selectedSchemas: ["public"] });
    await user.click(screen.getByTestId("erd-schema-filter"));
    await user.click(screen.getByTestId("erd-schema-filter-option-all"));
    expect(mockSetErdTabSchemas).toHaveBeenCalledWith("tab-1", undefined);
  });

  it("Export PNG dispatches exportPng with the live svg element", async () => {
    const user = userEvent.setup();
    const { stub } = renderToolbar();
    await user.click(screen.getByTestId("erd-export-menu"));
    await user.click(screen.getByTestId("erd-export-png"));
    expect(mockExportPng).toHaveBeenCalledTimes(1);
    expect(mockExportPng.mock.calls[0]?.[0]).toBe(stub.svg);
  });

  it("Export SVG dispatches exportSvg with the live svg element", async () => {
    const user = userEvent.setup();
    const { stub } = renderToolbar();
    await user.click(screen.getByTestId("erd-export-menu"));
    await user.click(screen.getByTestId("erd-export-svg"));
    expect(mockExportSvg).toHaveBeenCalledTimes(1);
    expect(mockExportSvg.mock.calls[0]?.[0]).toBe(stub.svg);
  });

  it("has zero axe violations", async () => {
    const { container } = renderToolbar();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
