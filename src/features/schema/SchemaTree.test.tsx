import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "../../i18n";
import { type NodeChild, useSchema } from "./store";

// S16: mock InferredSchemaPanel so tests are hermetic (no inference store needed).
vi.mock("../jsonb/panels/InferredSchemaPanel", () => ({
  InferredSchemaPanel: ({
    connId,
    fqn,
  }: { connId: string; fqn: { schema: string; table: string; column: string } }) => (    <div data-testid="inferred-panel-mock">
      panel:{connId}:{fqn.schema}.{fqn.table}.{fqn.column}
    </div>
),
}));

// react-arborist relies on ResizeObserver; jsdom doesn't ship it. Stub a
// minimal no-op so the Tree mounts.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// biome-ignore lint/suspicious/noExplicitAny: jsdom shim
(globalThis as any).ResizeObserver = ResizeObserverStub;

import { SchemaTree } from "./SchemaTree";

const initial = useSchema.getState();

const schemasRoot: NodeChild[] = [
  { id: "schema:public", name: "public", kind: "schema", hasChildren: true },
];
const schemaPublic: NodeChild[] = [
  {
    id: "schema:public/tables",
    name: "schema.tree.tables_group",
    kind: "tables-group",
    hasChildren: true,
  },
  {
    id: "schema:public/views",
    name: "schema.tree.views_group",
    kind: "views-group",
    hasChildren: true,
  },
];
const tables: NodeChild[] = [
  { id: "table:public/users", name: "users", kind: "table", hasChildren: false },
  { id: "table:public/orders", name: "orders", kind: "table", hasChildren: false },
];

function seedFullCache() {
  useSchema.setState({
    connection: {
      status: "connected",
      connId: "c1",
      serverVersion: "PG",
      database: "db",
    },
    cache: new Map<string, NodeChild[]>([
      ["schemas", schemasRoot],
      ["schema:public", schemaPublic],
      ["schema:public/tables", tables],
    ]),
    selectedNode: null,
    filter: "",
  });
}

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
      <SchemaTree />
    </I18nextProvider>,
);
}

beforeEach(reset);
afterEach(reset);

describe("<SchemaTree>", () => {
  test("renders cached schemas as treeitems", async () => {
    seedFullCache();
    renderUI();

    await waitFor(() => {
      expect(screen.getByText("public")).toBeInTheDocument();
    });
  });

  test("calls loadChildren on toggle when a parent is not yet cached", async () => {
    const loadChildrenSpy = vi.fn().mockResolvedValue([]);
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "c1",
        serverVersion: "PG",
        database: "db",
      },
      cache: new Map<string, NodeChild[]>([["schemas", schemasRoot]]),
      loadChildren: loadChildrenSpy,
    });
    renderUI();

    const row = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(row);

    expect(loadChildrenSpy).toHaveBeenCalledWith("schema:public");
  });

  test("clicking a table row calls selectNode", async () => {
    seedFullCache();
    const selectSpy = vi.fn();
    useSchema.setState({ selectNode: selectSpy });
    renderUI();

    // The table rows are nested under closed parents — open them via the
    // store cache being present + tree's openByDefault is false. Force-open
    // by setting initial selection via DOM walk: click each parent first.
    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesGroupRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesGroupRow);

    const userRow = await screen.findByTestId("schema-tree-row-table:public/users");
    await userEvent.click(userRow);

    expect(selectSpy).toHaveBeenCalledWith("table:public/users");
  });

  test("right-click on a table opens the context menu with Copy name + disabled stubs", async () => {
    seedFullCache();
    renderUI();

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesGroupRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesGroupRow);

    const userRow = await screen.findByTestId("schema-tree-row-table:public/users");
    fireEvent.contextMenu(userRow);

    const menu = await screen.findByTestId("schema-tree-context-menu");
    expect(menu).toBeInTheDocument();

    const copyBtn = screen.getByRole("menuitem", {
      name: new RegExp(i18n.t("schema.tree.copy_name")),
    });
    expect(copyBtn).not.toBeDisabled();

    const dropBtn = screen.getByRole("menuitem", { name: i18n.t("schema.tree.menu.drop") });
    expect(dropBtn).toBeDisabled();
    // Tooltip carries the sprint number via i18next interpolation.
    expect(dropBtn.getAttribute("title")).toContain("23");
  });

  test("Copy name writes 'schema.table' to the clipboard", async () => {
    seedFullCache();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderUI();

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesGroupRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesGroupRow);
    const userRow = await screen.findByTestId("schema-tree-row-table:public/users");
    fireEvent.contextMenu(userRow);

    const copyBtn = await screen.findByRole("menuitem", {
      name: new RegExp(i18n.t("schema.tree.copy_name")),
    });
    await userEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith("public.users");
  });

  test("filter prop limits visible nodes", async () => {
    seedFullCache();
    useSchema.setState({ filter: "users" });
    renderUI();

    // react-arborist auto-expands ancestor paths of matched nodes when a
    // searchTerm is set. 'users' matches; 'orders' must be filtered out.
    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });
    expect(screen.queryByText("orders")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S16 — JSONB inferred schema panel integration
// ---------------------------------------------------------------------------

const columnsWithJsonb: NodeChild[] = [
  {
    id: "column:public/events/id",
    name: "id",
    kind: "column",
    hasChildren: false,
    dataType: "integer",
  },
  {
    id: "column:public/events/payload",
    name: "payload",
    kind: "column",
    hasChildren: false,
    dataType: "jsonb",
  },
  {
    id: "column:public/events/meta",
    name: "meta",
    kind: "column",
    hasChildren: false,
    dataType: "json",
  },
];

const eventsTable: NodeChild[] = [
  { id: "table:public/events", name: "events", kind: "table", hasChildren: true },
];

function seedJsonbCache() {
  useSchema.setState({
    connection: {
      status: "connected",
      connId: "conn-jsonb",
      serverVersion: "PG16",
      database: "testdb",
    },
    cache: new Map<string, NodeChild[]>([
      ["schemas", [{ id: "schema:public", name: "public", kind: "schema", hasChildren: true }]],
      [
        "schema:public",
        [
          {
            id: "schema:public/tables",
            name: "schema.tree.tables_group",
            kind: "tables-group",
            hasChildren: true,
          },
          {
            id: "schema:public/views",
            name: "schema.tree.views_group",
            kind: "views-group",
            hasChildren: true,
          },
        ],
      ],
      ["schema:public/tables", eventsTable],
      ["table:public/events", columnsWithJsonb],
    ]),
    selectedNode: null,
    filter: "",
  });
}

describe("SchemaTree — S16 JSONB inferred schema panel", () => {
  beforeEach(reset);
  afterEach(reset);

  test("renders JSONB chevron button next to a jsonb column row", async () => {
    seedJsonbCache();
    renderUI();

    // Open schema → tables group → events table to reveal columns.
    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const eventsRow = await screen.findByTestId("schema-tree-row-table:public/events");
    await userEvent.click(eventsRow);

    // The jsonb column should have a chevron toggle button.
    const chevron = await screen.findByTestId(      "schema-tree-jsonb-chevron-column:public/events/payload",
);
    expect(chevron).toBeInTheDocument();
    expect(chevron).toHaveAttribute("aria-expanded", "false");

    // The plain integer column must NOT have a chevron.
    expect(      screen.queryByTestId("schema-tree-jsonb-chevron-column:public/events/id"),
).not.toBeInTheDocument();
  });

  test("clicking the chevron mounts InferredSchemaPanel with correct connId + fqn", async () => {
    seedJsonbCache();
    renderUI();

    // Navigate down to expose column nodes.
    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const eventsRow = await screen.findByTestId("schema-tree-row-table:public/events");
    await userEvent.click(eventsRow);

    // Panel is not visible yet.
    expect(screen.queryByTestId("inferred-panel-mock")).not.toBeInTheDocument();

    // Click the chevron.
    const chevron = await screen.findByTestId(      "schema-tree-jsonb-chevron-column:public/events/payload",
);
    await userEvent.click(chevron);

    // InferredSchemaPanel (mocked) should render with correct props.
    const panel = await screen.findByTestId("inferred-panel-mock");
    expect(panel).toHaveTextContent("panel:conn-jsonb:public.events.payload");

    // Re-query the chevron after re-render to check updated aria-expanded.
    await waitFor(() => {
      const updatedChevron = screen.getByTestId(        "schema-tree-jsonb-chevron-column:public/events/payload",
);
      expect(updatedChevron).toHaveAttribute("aria-expanded", "true");
    });
  });

  test("clicking chevron again collapses the panel", async () => {
    seedJsonbCache();
    renderUI();

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const eventsRow = await screen.findByTestId("schema-tree-row-table:public/events");
    await userEvent.click(eventsRow);

    const chevron = await screen.findByTestId(      "schema-tree-jsonb-chevron-column:public/events/payload",
);

    // Expand.
    await userEvent.click(chevron);
    expect(await screen.findByTestId("inferred-panel-mock")).toBeInTheDocument();

    // Re-query chevron after re-render then collapse.
    const chevronAfterExpand = await screen.findByTestId(      "schema-tree-jsonb-chevron-column:public/events/payload",
);
    await userEvent.click(chevronAfterExpand);
    await waitFor(() => {
      expect(screen.queryByTestId("inferred-panel-mock")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      const chevronAfterCollapse = screen.getByTestId(        "schema-tree-jsonb-chevron-column:public/events/payload",
);
      expect(chevronAfterCollapse).toHaveAttribute("aria-expanded", "false");
    });
  });

  test("json-typed column also gets a chevron (json is treated as jsonb)", async () => {
    seedJsonbCache();
    renderUI();

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const eventsRow = await screen.findByTestId("schema-tree-row-table:public/events");
    await userEvent.click(eventsRow);

    // The json column ("meta") should also have a chevron.
    const chevron = await screen.findByTestId(      "schema-tree-jsonb-chevron-column:public/events/meta",
);
    expect(chevron).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S17 — context-menu items on JSONB columns
// ---------------------------------------------------------------------------

describe("S17 context-menu items on JSONB columns", () => {
  beforeEach(reset);
  afterEach(reset);

  async function openEventsColumns() {
    seedJsonbCache();
    renderUI();
    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const eventsRow = await screen.findByTestId("schema-tree-row-table:public/events");
    await userEvent.click(eventsRow);
  }

  test("shows 'Build query…' and 'Suggest GIN index…' on a JSONB column", async () => {
    await openEventsColumns();
    const payloadRow = await screen.findByTestId("schema-tree-row-column:public/events/payload");
    fireEvent.contextMenu(payloadRow);

    const menu = await screen.findByTestId("schema-tree-context-menu");
    expect(menu).toBeInTheDocument();

    expect(      screen.getByRole("menuitem", { name: i18n.t("schema.tree.menu.buildJsonbQuery") }),
).toBeInTheDocument();
    expect(      screen.getByRole("menuitem", { name: i18n.t("schema.tree.menu.suggestGinIndex") }),
).toBeInTheDocument();
  });

  test("does NOT show these items on non-JSONB columns", async () => {
    await openEventsColumns();
    // "id" column has dataType "integer" — not JSONB.
    const idRow = await screen.findByTestId("schema-tree-row-column:public/events/id");
    fireEvent.contextMenu(idRow);

    // The menu should not appear at all for non-JSONB columns (handleContextMenu
    // is only triggered for table/view/column-jsonb nodes).
    expect(screen.queryByTestId("schema-tree-context-menu")).not.toBeInTheDocument();
  });

  test("clicking 'Build query…' invokes onOpenBuilder with the right FQN", async () => {
    const onOpenBuilder = vi.fn();
    seedJsonbCache();
    render(      <I18nextProvider i18n={i18n}>
        <SchemaTree onOpenBuilder={onOpenBuilder} />
      </I18nextProvider>,
);

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const eventsRow = await screen.findByTestId("schema-tree-row-table:public/events");
    await userEvent.click(eventsRow);

    const payloadRow = await screen.findByTestId("schema-tree-row-column:public/events/payload");
    fireEvent.contextMenu(payloadRow);

    const buildBtn = await screen.findByRole("menuitem", {
      name: i18n.t("schema.tree.menu.buildJsonbQuery"),
    });
    await userEvent.click(buildBtn);

    expect(onOpenBuilder).toHaveBeenCalledWith({
      schema: "public",
      table: "events",
      column: "payload",
    });
  });

  test("clicking 'Suggest GIN index…' invokes onOpenSuggester with the right FQN", async () => {
    const onOpenSuggester = vi.fn();
    seedJsonbCache();
    render(      <I18nextProvider i18n={i18n}>
        <SchemaTree onOpenSuggester={onOpenSuggester} />
      </I18nextProvider>,
);

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const eventsRow = await screen.findByTestId("schema-tree-row-table:public/events");
    await userEvent.click(eventsRow);

    const payloadRow = await screen.findByTestId("schema-tree-row-column:public/events/payload");
    fireEvent.contextMenu(payloadRow);

    const suggestBtn = await screen.findByRole("menuitem", {
      name: i18n.t("schema.tree.menu.suggestGinIndex"),
    });
    await userEvent.click(suggestBtn);

    expect(onOpenSuggester).toHaveBeenCalledWith({
      schema: "public",
      table: "events",
      column: "payload",
    });
  });
});

// S23 — object-editor entry points from SchemaTree context-menu.
describe("S23 — context-menu entry-points to object editor", () => {
  test("right-click on a schema node shows 4 'New …' items", async () => {
    seedJsonbCache();
    render(      <I18nextProvider i18n={i18n}>
        <SchemaTree />
      </I18nextProvider>,
);

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    fireEvent.contextMenu(schemaRow);

    expect(await screen.findByTestId("schema-tree-menu-new-table")).toBeInTheDocument();
    expect(screen.getByTestId("schema-tree-menu-new-view")).toBeInTheDocument();
    expect(screen.getByTestId("schema-tree-menu-new-matview")).toBeInTheDocument();
    expect(screen.getByTestId("schema-tree-menu-new-sequence")).toBeInTheDocument();
  });

  test("clicking 'New table…' on schema node opens object-editor in create mode", async () => {
    const openObjectEditor = vi.fn();
    const editorMod = await import("../editor/store");
    const original = editorMod.useEditor.getState();
    editorMod.useEditor.setState({ ...original, openObjectEditor });

    seedJsonbCache();
    render(      <I18nextProvider i18n={i18n}>
        <SchemaTree />
      </I18nextProvider>,
);

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    fireEvent.contextMenu(schemaRow);
    const btn = await screen.findByTestId("schema-tree-menu-new-table");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(openObjectEditor).toHaveBeenCalledWith(        expect.objectContaining({
          objectKind: "table",
          mode: "create",
          schema: "public",
        }),
);
    });
  });

  test("right-click on a table node shows 'Edit table…' + 'New index on this table…'", async () => {
    seedJsonbCache();
    render(      <I18nextProvider i18n={i18n}>
        <SchemaTree />
      </I18nextProvider>,
);

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const tableRow = await screen.findByTestId("schema-tree-row-table:public/events");
    fireEvent.contextMenu(tableRow);

    expect(await screen.findByTestId("schema-tree-menu-edit-table")).toBeInTheDocument();
    expect(screen.getByTestId("schema-tree-menu-new-index-on-table")).toBeInTheDocument();
  });

  test("clicking 'Edit table…' opens editor in edit mode with table name", async () => {
    const openObjectEditor = vi.fn();
    const editorMod = await import("../editor/store");
    editorMod.useEditor.setState({
      ...editorMod.useEditor.getState(),
      openObjectEditor,
    });

    seedJsonbCache();
    render(      <I18nextProvider i18n={i18n}>
        <SchemaTree />
      </I18nextProvider>,
);

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const tableRow = await screen.findByTestId("schema-tree-row-table:public/events");
    fireEvent.contextMenu(tableRow);
    const btn = await screen.findByTestId("schema-tree-menu-edit-table");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(openObjectEditor).toHaveBeenCalledWith(        expect.objectContaining({
          objectKind: "table",
          mode: "edit",
          schema: "public",
          name: "events",
        }),
);
    });
  });

  test("clicking 'New index on this table…' passes parentTable", async () => {
    const openObjectEditor = vi.fn();
    const editorMod = await import("../editor/store");
    editorMod.useEditor.setState({
      ...editorMod.useEditor.getState(),
      openObjectEditor,
    });

    seedJsonbCache();
    render(      <I18nextProvider i18n={i18n}>
        <SchemaTree />
      </I18nextProvider>,
);

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    await userEvent.click(schemaRow);
    const tablesRow = await screen.findByTestId("schema-tree-row-schema:public/tables");
    await userEvent.click(tablesRow);
    const tableRow = await screen.findByTestId("schema-tree-row-table:public/events");
    fireEvent.contextMenu(tableRow);
    const btn = await screen.findByTestId("schema-tree-menu-new-index-on-table");
    await userEvent.click(btn);

    await waitFor(() => {
      expect(openObjectEditor).toHaveBeenCalledWith(        expect.objectContaining({
          objectKind: "index",
          mode: "create",
          schema: "public",
          parentTable: "events",
        }),
);
    });
  });

  test("schema node menu does NOT show PENDING placeholder items", async () => {
    seedJsonbCache();
    render(      <I18nextProvider i18n={i18n}>
        <SchemaTree />
      </I18nextProvider>,
);

    const schemaRow = await screen.findByTestId("schema-tree-row-schema:public");
    fireEvent.contextMenu(schemaRow);

    // No "View data" / "Drop" / etc. on schema-level — those are table/view scoped.
    expect(screen.queryByText(i18n.t("schema.tree.menu.view_data"))).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("schema.tree.menu.drop"))).not.toBeInTheDocument();
  });
});
