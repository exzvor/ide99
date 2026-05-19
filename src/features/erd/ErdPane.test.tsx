/**
 * — ErdPane (C5) wire-up tests.
 *
 * Each branch of the loading / empty / error / ready ladder maps to a
 * stable `data-state` attribute on the root container — Playwright uses
 * the same attribute in Phase 3.
 *
 * The data-fetch hook + the dagre layout function are mocked so this
 * test focuses on the state-machine wiring rather than the graph
 * computation itself.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErdSchemaGraph } from "../../lib/tauri";
import type { ErdLoadState } from "./store";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const FAKE_DICT: Record<string, string> = {
  "erd.loading": "Loading schema graph",
  "erd.empty.title": "No tables to render",
  "erd.empty.body": "The selected schema(s) have no relations.",
  "erd.error.title": "Couldn't generate ERD",
  "erd.error.retry": "Retry",
  "erd.toolbar.stats": "{{tableCount}} t · {{fkCount}} fk · {{layoutMs}} ms",
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

let mockState: ErdLoadState = { kind: "idle" };
const mockRetry = vi.fn();

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return {
    ...actual,
    useErdGraph: () => ({ state: mockState, retry: mockRetry }),
  };
});

// Stub layoutGraph so we don't depend on B's pure function shape and
// can short-circuit to a tiny laid graph.
vi.mock("./layout", async () => {
  const actual = await vi.importActual<typeof import("./layout")>("./layout");
  return {
    ...actual,
    layoutGraph: (graph: ErdSchemaGraph) => ({
      nodes: graph.tables.map((t, i) => ({
        id: `${t.schema}.${t.name}`,
        schema: t.schema,
        name: t.name,
        columns: t.columns,
        x: i * 250,
        y: 0,
        width: 240,
        height: 60,
      })),
      edges: [],
      width: graph.tables.length * 250,
      height: 100,
      layoutMs: 5,
    }),
  };
});

// Replace the editor store with a stub so the toolbar's
// setErdTabSchemas call doesn't blow up if invoked.
vi.mock("../editor/store", () => ({
  useEditor: {
    getState: () => ({ setErdTabSchemas: vi.fn() }),
  },
}));

// Polyfills required by Radix popover / dropdown when the ready branch renders
// the toolbar.
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

import { ErdPane } from "./ErdPane";

beforeEach(() => {
  mockState = { kind: "idle" };
  mockRetry.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleGraph: ErdSchemaGraph = {
  tables: [{ schema: "public", name: "users", columns: [] }],
  foreignKeys: [],
  fetchedInMs: 12,
};

describe("ErdPane", () => {
  it("loading state renders erd.loading and data-state='loading'", () => {
    mockState = { kind: "loading" };
    const { container } = render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    const pane = container.querySelector('[data-testid="erd-pane"]');
    expect(pane).toHaveAttribute("data-state", "loading");
    expect(screen.getByText("Loading schema graph")).toBeInTheDocument();
  });

  it("empty state (ready + zero tables) renders erd.empty.title and data-state='empty'", () => {
    mockState = {
      kind: "ready",
      graph: { tables: [], foreignKeys: [], fetchedInMs: 0 },
    };
    const { container } = render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    const pane = container.querySelector('[data-testid="erd-pane"]');
    expect(pane).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("No tables to render")).toBeInTheDocument();
  });

  it("error state renders the title + a Retry button that calls retry()", async () => {
    const user = userEvent.setup();
    mockState = { kind: "error", message: "boom" };
    const { container } = render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    const pane = container.querySelector('[data-testid="erd-pane"]');
    expect(pane).toHaveAttribute("data-state", "error");
    expect(screen.getByText("Couldn't generate ERD")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /Retry/i });
    await user.click(retry);
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("ready state renders <Toolbar /> + <Canvas />", () => {
    mockState = { kind: "ready", graph: sampleGraph };
    const { container } = render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    const pane = container.querySelector('[data-testid="erd-pane"]');
    expect(pane).toHaveAttribute("data-state", "ready");
    expect(screen.getByTestId("erd-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("erd-canvas")).toBeInTheDocument();
  });
});
