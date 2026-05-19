import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "../../i18n";

// Mock the SchemaTree to avoid pulling in react-arborist's DOM machinery
// during state-branch unit tests — its rendering is exercised by the
// dedicated SchemaTree test.
vi.mock("./SchemaTree", () => ({
  SchemaTree: () => <div data-testid="schema-tree-mock" />,
}));

vi.mock("../pgvector/extensionProbe", () => ({
  isPgvectorInstalled: vi.fn().mockResolvedValue(true),
  _clearPgvectorProbeCache: vi.fn(),
}));

vi.mock("../postgis/extensionProbe", () => ({
  isPostgisInstalled: vi.fn().mockResolvedValue(true),
  _clearPostgisProbeCache: vi.fn(),
}));

vi.mock("../timescale/extensionProbe", () => ({
  isTimescaleInstalled: vi.fn().mockResolvedValue(true),
  _clearTimescaleProbeCache: vi.fn(),
}));

vi.mock("../timescale/hypertableRegistry", () => ({
  loadHypertables: vi.fn().mockResolvedValue(new Map()),
  isHypertable: vi.fn().mockReturnValue(false),
  isContinuousAggregate: vi.fn().mockReturnValue(false),
  invalidateHypertableCache: vi.fn(),
  _clearHypertableRegistry: vi.fn(),
}));

vi.mock("../pgpartman/extensionProbe", () => ({
  isPgPartmanInstalled: vi.fn().mockResolvedValue(true),
  _clearPgPartmanProbeCache: vi.fn(),
}));
vi.mock("../pgpartman/pgPartmanRegistry", () => ({
  loadPgPartmanParents: vi.fn().mockResolvedValue(new Map()),
  isPartmanParent: vi.fn().mockReturnValue(false),
  invalidatePgPartmanCache: vi.fn(),
  _clearPgPartmanRegistry: vi.fn(),
}));

vi.mock("../pgstatstatements/extensionProbe", () => ({
  isPgStatStatementsInstalled: vi.fn().mockResolvedValue(true),
  _clearPgStatStatementsProbeCache: vi.fn(),
}));

vi.mock("../pgrepack/extensionProbe", () => ({
  isPgRepackInstalled: vi.fn().mockResolvedValue(true),
  _clearPgRepackProbeCache: vi.fn(),
}));

import { useEditor } from "../editor/store";
import { SchemaBrowser } from "./SchemaBrowser";
import { useSchema } from "./store";

const initial = useSchema.getState();

function reset() {
  useSchema.setState(    {
      ...initial,
      connection: { status: "idle" },
      cache: new Map(),
      selectedNode: null,
      filter: "",
    },
    true,
);
}

function renderUI() {
  return render(    <I18nextProvider i18n={i18n}>
      <SchemaBrowser />
    </I18nextProvider>,
);
}

beforeEach(reset);
afterEach(reset);

describe("<SchemaBrowser>", () => {
  test("idle: renders the idle EmptyState with browser_aria region", () => {
    renderUI();

    const browser = screen.getByTestId("schema-browser");
    expect(browser).toHaveAttribute("aria-label", i18n.t("schema.browser_aria"));
    expect(screen.getByTestId("schema-empty-idle")).toBeInTheDocument();
  });

  test("connecting: renders spinner + connecting copy", () => {
    useSchema.setState({ connection: { status: "connecting", connId: "c1" } });
    renderUI();

    expect(screen.getByTestId("schema-connecting")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("schema.connecting"))).toBeInTheDocument();
    expect(screen.queryByTestId("schema-empty-idle")).not.toBeInTheDocument();
  });

  test("error: renders error EmptyState; Retry calls connect(connId) again", async () => {
    const connectSpy = vi.fn().mockResolvedValue(undefined);
    useSchema.setState({
      connection: { status: "error", connId: "c1", error: null, message: "boom" },
      connect: connectSpy,
    });
    renderUI();

    expect(screen.getByText("boom")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: i18n.t("schema.retry") });
    await userEvent.click(retry);
    expect(connectSpy).toHaveBeenCalledWith("c1");
  });

  test("connected: renders header (refresh + search) + tree", async () => {
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    const setFilterSpy = vi.fn();
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "c1",
        serverVersion: "PG",
        database: "db",
      },
      refreshAll: refreshSpy,
      setFilter: setFilterSpy,
    });
    renderUI();

    expect(screen.getByTestId("schema-browser-header")).toBeInTheDocument();
    expect(screen.getByTestId("schema-tree-mock")).toBeInTheDocument();

    const refresh = screen.getByRole("button", { name: i18n.t("schema.refresh") });
    expect(refresh).toBeInTheDocument();
    await userEvent.click(refresh);
    expect(refreshSpy).toHaveBeenCalled();

    const search = screen.getByPlaceholderText(i18n.t("schema.search.placeholder"));
    await userEvent.type(search, "a");
    expect(setFilterSpy).toHaveBeenCalledWith("a");
  });

  test("Generate ERD button is absent when not connected", () => {
    renderUI();
    expect(screen.queryByTestId("schema-erd-open")).not.toBeInTheDocument();
  });

  test("connected: Generate ERD button calls openErdTab(connId)", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-7",
        serverVersion: "PG",
        database: "db",
      },
    });
    const openErdTab = vi.fn();
    const realState = useEditor.getState();
    vi.spyOn(useEditor, "getState").mockReturnValue({ ...realState, openErdTab });

    renderUI();
    const btn = screen.getByTestId("schema-erd-open");
    expect(btn).toHaveAttribute("aria-label", i18n.t("erd.browser.open_button_aria"));
    await userEvent.click(btn);
    expect(openErdTab).toHaveBeenCalledWith("conn-7");
  });
});

describe("S23 — '+ New' toolbar dropdown", () => {
  test("dropdown toggle is absent when not connected", () => {
    renderUI();
    expect(screen.queryByTestId("schema-new-dropdown-toggle")).not.toBeInTheDocument();
  });

  test("connected: '+ New' toggle opens dropdown with 5 object kinds", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s23",
        serverVersion: "PG",
        database: "db",
      },
    });

    renderUI();
    const toggle = screen.getByTestId("schema-new-dropdown-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);

    expect(screen.getByTestId("schema-new-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("schema-new-table")).toBeInTheDocument();
    expect(screen.getByTestId("schema-new-view")).toBeInTheDocument();
    expect(screen.getByTestId("schema-new-matview")).toBeInTheDocument();
    expect(screen.getByTestId("schema-new-index")).toBeInTheDocument();
    expect(screen.getByTestId("schema-new-sequence")).toBeInTheDocument();
  });

  test("clicking 'Table…' opens object-editor in create mode for inferred schema", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s23-2",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "schema:app",
    });

    const openObjectEditor = vi.fn();
    const realState = useEditor.getState();
    vi.spyOn(useEditor, "getState").mockReturnValue({ ...realState, openObjectEditor });

    renderUI();
    await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));
    await userEvent.click(screen.getByTestId("schema-new-table"));

    expect(openObjectEditor).toHaveBeenCalledWith({
      connectionId: "conn-s23-2",
      objectKind: "table",
      mode: "create",
      schema: "app",
    });
  });

  test("falls back to 'public' when no node is selected", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s23-3",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: null,
    });

    const openObjectEditor = vi.fn();
    const realState = useEditor.getState();
    vi.spyOn(useEditor, "getState").mockReturnValue({ ...realState, openObjectEditor });

    renderUI();
    await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));
    await userEvent.click(screen.getByTestId("schema-new-sequence"));

    expect(openObjectEditor).toHaveBeenCalledWith({
      connectionId: "conn-s23-3",
      objectKind: "sequence",
      mode: "create",
      schema: "public",
    });
  });
});

describe("S24 — '+ New' toolbar dropdown extensions (function/procedure/trigger)", () => {
  test("dropdown shows function/procedure/trigger items", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s24",
        serverVersion: "PG",
        database: "db",
      },
    });

    renderUI();
    await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));

    expect(screen.getByTestId("schema-new-function")).toBeInTheDocument();
    expect(screen.getByTestId("schema-new-procedure")).toBeInTheDocument();
    expect(screen.getByTestId("schema-new-trigger")).toBeInTheDocument();
  });

  test("clicking 'Function…' opens function editor in create mode for inferred schema", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s24-f",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "schema:public",
    });

    const openObjectEditor = vi.fn();
    const realState = useEditor.getState();
    vi.spyOn(useEditor, "getState").mockReturnValue({ ...realState, openObjectEditor });

    renderUI();
    await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));
    await userEvent.click(screen.getByTestId("schema-new-function"));

    expect(openObjectEditor).toHaveBeenCalledWith({
      connectionId: "conn-s24-f",
      objectKind: "function",
      mode: "create",
      schema: "public",
    });
  });

  test("clicking 'Trigger…' opens trigger editor in create mode", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s24-t",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "schema:public",
    });

    const openObjectEditor = vi.fn();
    const realState = useEditor.getState();
    vi.spyOn(useEditor, "getState").mockReturnValue({ ...realState, openObjectEditor });

    renderUI();
    await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));
    await userEvent.click(screen.getByTestId("schema-new-trigger"));

    expect(openObjectEditor).toHaveBeenCalledWith({
      connectionId: "conn-s24-t",
      objectKind: "trigger",
      mode: "create",
      schema: "public",
    });
  });
});

describe("S25 — '+ New' toolbar dropdown extensions (FDW/Pub/Sub/Role/Type)", () => {
  // Top-level entries (FDW/Pub/Sub/Role + Type-trigger). Type variants
  // live behind the `schema-new-type` submenu after .
  const topLevelKinds: Array<{ testid: string; objectKind: string }> = [
    { testid: "schema-new-fdw-server", objectKind: "fdw_server" },
    { testid: "schema-new-publication", objectKind: "publication" },
    { testid: "schema-new-subscription", objectKind: "subscription" },
    { testid: "schema-new-role", objectKind: "role" },
  ];
  const typeSubKinds: Array<{ testid: string; objectKind: string }> = [
    { testid: "schema-new-enum-type", objectKind: "enum_type" },
    { testid: "schema-new-composite-type", objectKind: "composite_type" },
    { testid: "schema-new-domain-type", objectKind: "domain_type" },
    { testid: "schema-new-range-type", objectKind: "range_type" },
  ];

  test("dropdown shows 4 S25 top-level entries + a single Type submenu trigger (13 entries total, not 16)", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s25",
        serverVersion: "PG",
        database: "db",
      },
    });

    renderUI();
    await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));

    for (const { testid } of topLevelKinds) {
      expect(screen.getByTestId(testid)).toBeInTheDocument();
    }
    // 4 type variants are NOT in the main dropdown.
    for (const { testid } of typeSubKinds) {
      expect(screen.queryByTestId(testid)).not.toBeInTheDocument();
    }
    // Single Type-submenu trigger replaces the 4 separate type buttons.
    expect(screen.getByTestId("schema-new-type")).toBeInTheDocument();
  });

  test("clicking 'Type' opens submenu with 4 type variants + Back", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s25-typemenu",
        serverVersion: "PG",
        database: "db",
      },
    });

    renderUI();
    await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));
    await userEvent.click(screen.getByTestId("schema-new-type"));

    for (const { testid } of typeSubKinds) {
      expect(screen.getByTestId(testid)).toBeInTheDocument();
    }
    expect(screen.getByTestId("schema-new-type-back")).toBeInTheDocument();
  });

  test("Back button returns to main dropdown", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s25-back",
        serverVersion: "PG",
        database: "db",
      },
    });

    renderUI();
    await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));
    await userEvent.click(screen.getByTestId("schema-new-type"));
    expect(screen.queryByTestId("schema-new-fdw-server")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("schema-new-type-back"));
    expect(screen.getByTestId("schema-new-fdw-server")).toBeInTheDocument();
  });

  for (const { testid, objectKind } of topLevelKinds) {
    test(`clicking '${objectKind}' menu item opens the right editor`, async () => {
      useSchema.setState({
        connection: {
          status: "connected",
          connId: `conn-s25-${objectKind}`,
          serverVersion: "PG",
          database: "db",
        },
        selectedNode: "schema:public",
      });

      const openObjectEditor = vi.fn();
      const realState = useEditor.getState();
      vi.spyOn(useEditor, "getState").mockReturnValue({ ...realState, openObjectEditor });

      renderUI();
      await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));
      await userEvent.click(screen.getByTestId(testid));

      expect(openObjectEditor).toHaveBeenCalledWith({
        connectionId: `conn-s25-${objectKind}`,
        objectKind,
        mode: "create",
        schema: "public",
      });
    });
  }

  for (const { testid, objectKind } of typeSubKinds) {
    test(`clicking '${objectKind}' inside Type submenu opens the right editor`, async () => {
      useSchema.setState({
        connection: {
          status: "connected",
          connId: `conn-s25-${objectKind}`,
          serverVersion: "PG",
          database: "db",
        },
        selectedNode: "schema:public",
      });

      const openObjectEditor = vi.fn();
      const realState = useEditor.getState();
      vi.spyOn(useEditor, "getState").mockReturnValue({ ...realState, openObjectEditor });

      renderUI();
      await userEvent.click(screen.getByTestId("schema-new-dropdown-toggle"));
      await userEvent.click(screen.getByTestId("schema-new-type"));
      await userEvent.click(screen.getByTestId(testid));

      expect(openObjectEditor).toHaveBeenCalledWith({
        connectionId: `conn-s25-${objectKind}`,
        objectKind,
        mode: "create",
        schema: "public",
      });
    });
  }
});

describe("S26 — PgvectorTablePanel slot", () => {
  test("renders the panel below the tree when selected table has a vector column", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s26",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "table:public/items",
      cache: new Map([
        [
          "table:public/items",
          [
            {
              id: "column:public/items/id",
              name: "id",
              kind: "column",
              hasChildren: false,
              dataType: "int4",
            },
            {
              id: "column:public/items/embedding",
              name: "embedding",
              kind: "column",
              hasChildren: false,
              dataType: "vector(3)",
            },
          ],
        ],
      ]),
    });
    renderUI();
    expect(await screen.findByTestId("pgvector-table-panel")).toBeInTheDocument();
  });

  test("does not render the panel when selected table has no vector columns", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s26",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "table:public/users",
      cache: new Map([
        [
          "table:public/users",
          [
            {
              id: "column:public/users/id",
              name: "id",
              kind: "column",
              hasChildren: false,
              dataType: "int4",
            },
            {
              id: "column:public/users/email",
              name: "email",
              kind: "column",
              hasChildren: false,
              dataType: "text",
            },
          ],
        ],
      ]),
    });
    renderUI();
    expect(screen.queryByTestId("pgvector-table-panel")).not.toBeInTheDocument();
  });
});

describe("S27 — PostgisTablePanel slot", () => {
  test("renders the panel when selected table has a geometry column and postgis is installed", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s27",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "table:public/places",
      cache: new Map([
        [
          "table:public/places",
          [
            {
              id: "column:public/places/id",
              name: "id",
              kind: "column",
              hasChildren: false,
              dataType: "int4",
            },
            {
              id: "column:public/places/geom",
              name: "geom",
              kind: "column",
              hasChildren: false,
              dataType: "geometry(Point,4326)",
            },
          ],
        ],
      ]),
    });
    renderUI();
    expect(await screen.findByTestId("postgis-table-panel")).toBeInTheDocument();
  });

  test("does not render the panel when table has no geometry column", () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s27",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "table:public/users",
      cache: new Map([
        [
          "table:public/users",
          [
            {
              id: "column:public/users/id",
              name: "id",
              kind: "column",
              hasChildren: false,
              dataType: "int4",
            },
            {
              id: "column:public/users/email",
              name: "email",
              kind: "column",
              hasChildren: false,
              dataType: "text",
            },
          ],
        ],
      ]),
    });
    renderUI();
    expect(screen.queryByTestId("postgis-table-panel")).not.toBeInTheDocument();
  });
});

describe("S28 — TimescaleTablePanel slot", () => {
  test("renders the panel for the selected table when timescale is installed", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-ts",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "table:public/metrics",
      cache: new Map([
        [
          "table:public/metrics",
          [
            {
              id: "column:public/metrics/ts",
              name: "ts",
              kind: "column",
              hasChildren: false,
              dataType: "timestamptz",
            },
          ],
        ],
      ]),
    });
    renderUI();
    expect(await screen.findByTestId("timescale-table-panel")).toBeInTheDocument();
  });

  test("does not render the panel when timescale is not installed", async () => {
    const probe = await import("../timescale/extensionProbe");
    (probe.isTimescaleInstalled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-no-ts",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "table:public/users",
      cache: new Map([
        [
          "table:public/users",
          [
            {
              id: "column:public/users/id",
              name: "id",
              kind: "column",
              hasChildren: false,
              dataType: "int4",
            },
          ],
        ],
      ]),
    });
    renderUI();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("timescale-table-panel")).not.toBeInTheDocument();
  });
});

describe("S29 — pg_partman + pg_repack panels + pg_stat_statements toolbar button", () => {
  test("renders both pgpartman + pgrepack panels for a selected table when extensions installed", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-s29",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: "table:public/events",
      cache: new Map([
        [
          "table:public/events",
          [
            {
              id: "column:public/events/created_at",
              name: "created_at",
              kind: "column",
              hasChildren: false,
              dataType: "timestamptz",
            },
          ],
        ],
      ]),
    });
    renderUI();
    expect(await screen.findByTestId("pg-partman-table-panel")).toBeInTheDocument();
    expect(await screen.findByTestId("pg-repack-panel-repack")).toBeInTheDocument();
  });

  test("renders Activity toolbar button when pg_stat_statements installed", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-pgss",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: null,
      cache: new Map(),
    });
    renderUI();
    expect(await screen.findByTestId("schema-pgss-open")).toBeInTheDocument();
  });

  test("clicking the Activity button opens a pg-stat-statements tab", async () => {
    const openPgStatStatementsTab = vi.fn().mockReturnValue({
      id: "pgss-conn-pgss",
      kind: "pg-stat-statements",
      connectionId: "conn-pgss",
      createdAt: new Date(0).toISOString(),
    });
    const realState = useEditor.getState();
    vi.spyOn(useEditor, "getState").mockReturnValue({ ...realState, openPgStatStatementsTab });
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-pgss",
        serverVersion: "PG",
        database: "db",
      },
      selectedNode: null,
      cache: new Map(),
    });
    renderUI();
    await userEvent.click(await screen.findByTestId("schema-pgss-open"));
    expect(openPgStatStatementsTab).toHaveBeenCalledWith("conn-pgss");
  });
});
