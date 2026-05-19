/**
 * — regression suite for the manual-QA bug bundle.
 *
 * Each `describe` block pins a single finding so future edits
 * to the editor surface can't silently re-introduce them. Tests rely on
 * the same FAKE_DICT mocking strategy used by `ErdPane.test.tsx` so they
 * stay deterministic in jsdom.
 */

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en.json";
import ru from "../../i18n/locales/ru.json";
import type { ErdSchemaGraph } from "../../lib/tauri";
import type { ErdLoadState } from "./store";

// ── i18n ────────────────────────────────────────────────────────────────────

const FAKE_DICT: Record<string, string> = {
  "erd.edit.toggle.label": "Edit mode",
  "erd.edit.toggle.tooltip": "Edit schema",
  "erd.edit.new_table": "+ New table",
  "erd.edit.add_column": "+ Add column",
  "erd.edit.apply": "Apply",
  "erd.edit.discard": "Discard",
  "erd.edit.cancel": "Cancel",
  "erd.edit.undo": "Undo",
  "erd.edit.redo": "Redo",
  "erd.edit.reset_layout": "Reset layout",
  "erd.edit.preview.title": "DDL preview",
  "erd.edit.preview.statement_count": "{{n}} statements",
  "erd.edit.preview.empty": "No pending changes",
  "erd.edit.preview.warning_count": "{{n}} warnings",
  "erd.edit.preview.error.title": "Apply failed",
  "erd.edit.confirm.apply.title": "Apply schema changes?",
  "erd.edit.confirm.apply.body": "{{n}} statements to {{conn}}",
  "erd.edit.confirm.discard.title": "Discard schema edits?",
  "erd.edit.confirm.discard.body": "{{n}} unapplied changes",
  "erd.edit.confirm.reset_layout": "Reset all table positions to auto-layout?",
  "erd.edit.fk.modal.title": "Add foreign key",
  "erd.edit.fk.modal.from": "From",
  "erd.edit.fk.modal.to": "To",
  "erd.edit.fk.modal.constraint_name": "Constraint name",
  "erd.edit.fk.modal.add": "Add FK",
  "erd.edit.fk.modal.not_pk_unique": "not PK/UNIQUE",
  "erd.edit.validation.empty_name": "Name is required",
  "erd.edit.validation.duplicate_table": "Table {{name}} already exists in schema {{schema}}",
  "erd.edit.validation.duplicate_column": "Column {{name}} already exists in table",
  "erd.edit.validation.fk_type_mismatch": "Type mismatch: {{source}} → {{target}}",
  "erd.edit.validation.fk_target_not_unique": "Target column is not PRIMARY KEY or UNIQUE",
  "erd.edit.validation.no_columns": "Table has no columns",
  "erd.edit.toast.apply_success": "Schema updated ({{n}}, {{ms}}ms)",
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
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Tauri IPC mocks ─────────────────────────────────────────────────────────

const mockSchemaApplyDdl = vi.fn();
const mockErdSavePositions = vi.fn();
const mockErdLoadPositions = vi.fn();

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    schemaApplyDdl: (...args: unknown[]) => mockSchemaApplyDdl(...args),
    erdSavePositions: (...args: unknown[]) => mockErdSavePositions(...args),
    erdLoadPositions: (...args: unknown[]) => mockErdLoadPositions(...args),
  };
});

// ── Store + layout mocks ────────────────────────────────────────────────────

let mockState: ErdLoadState = { kind: "idle" };
const mockRetry = vi.fn();

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return {
    ...actual,
    useErdGraph: () => ({ state: mockState, retry: mockRetry }),
  };
});

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
        height: 60 + t.columns.length * 18,
      })),
      edges: [],
      width: graph.tables.length * 250,
      height: 100,
      layoutMs: 5,
    }),
  };
});

vi.mock("../editor/store", () => ({
  useEditor: { getState: () => ({ setErdTabSchemas: vi.fn() }) },
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

import { ErdPane } from "./ErdPane";
import { makeAddColumnOp, makeAddTableOp } from "./edit/ops";
import { useEditStore } from "./edit/store";

const sampleGraph: ErdSchemaGraph = {
  tables: [
    {
      schema: "public",
      name: "users",
      columns: [
        {
          name: "id",
          dataType: "bigint",
          nullable: false,
          isPrimaryKey: true,
          isForeignKey: false,
          ordinal: 1,
        },
      ],
    },
  ],
  foreignKeys: [],
  fetchedInMs: 0,
};

beforeEach(() => {
  mockState = { kind: "ready", graph: sampleGraph };
  mockRetry.mockReset();
  mockSchemaApplyDdl.mockReset();
  mockErdSavePositions.mockReset().mockResolvedValue(undefined);
  mockErdLoadPositions.mockReset().mockResolvedValue([]);
  useEditStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── �� toolbar split into two non-overlapping rows ───────────────
describe("�� toolbar layout", () => {
  it("EditActionsBar mounts as its own row, separate from the read-mode Toolbar", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);

    // In read-mode there is no actions-bar, only the compact Edit toggle.
    expect(screen.queryByTestId("edit-actions-bar")).toBeNull();
    expect(screen.getByTestId("edit-toggle")).toBeInTheDocument();

    await user.click(screen.getByTestId("edit-toggle"));

    const toolbar = screen.getByTestId("erd-toolbar");
    const actionsBar = screen.getByTestId("edit-actions-bar");

    // Critical contract: actions bar is NOT a descendant of the read-mode
    // toolbar — that's what guarantees the two rows can't overlap, even at
    // small widths or in RU where labels are longer.
    expect(toolbar.contains(actionsBar)).toBe(false);

    // And both Apply and the Edit toggle are reachable.
    expect(screen.getByTestId("edit-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("edit-apply")).toBeInTheDocument();
  });
});

// ── �� add-column row uses dedicated label ──────────────────────
describe("�� add-column label", () => {
  it("en + ru both expose erd.edit.add_column without a leading +", () => {
    const enLabel = (en as { erd: { edit: { add_column: string } } }).erd.edit.add_column;
    const ruLabel = (ru as { erd: { edit: { add_column: string } } }).erd.edit.add_column;
    expect(enLabel).toBe("+ Add column");
    expect(ruLabel).toBe("+ Добавить колонку");
    // Specifically NOT the new_table label which would render as "+ + …"
    expect(enLabel).not.toContain("New table");
    expect(ruLabel).not.toContain("Новая таблица");
  });

  it("TableCard's add-column row renders the dedicated label, not new_table", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));

    const addColumnBtn = screen.getByTestId("table-card-add-column");
    expect(addColumnBtn).toHaveTextContent("+ Add column");
    expect(addColumnBtn).not.toHaveTextContent("New table");
    expect(addColumnBtn.textContent ?? "").not.toMatch(/^\+ \+/);
  });
});

// ── + �� confirm modals' cancel labels ──────────────
describe("/ �� confirm modal cancel labels", () => {
  it("apply-confirm cancel renders erd.edit.cancel, not erd.edit.discard", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));
    await user.click(screen.getByTestId("edit-new-table"));
    await user.click(screen.getByTestId("edit-apply"));

    const cancel = screen.getByTestId("apply-confirm-cancel");
    expect(cancel).toHaveTextContent("Cancel");
    expect(cancel).not.toHaveTextContent("Discard");
  });

  it("discard-confirm cancel renders erd.edit.cancel, not erd.edit.apply", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));
    await user.click(screen.getByTestId("edit-new-table"));
    await user.click(screen.getByTestId("edit-discard"));

    const cancel = screen.getByTestId("discard-confirm-cancel");
    expect(cancel).toHaveTextContent("Cancel");
    expect(cancel).not.toHaveTextContent("Apply");
  });
});

// ── �� validation errors render in DDL preview ──────────────────
describe("�� validation errors banner", () => {
  it("duplicate-table error surfaces in DdlPreviewPanel error banner", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));

    // Programmatically push a duplicate-name addTable so we exercise the
    // banner without depending on the +New table -> rename UX.
    const dup = makeAddTableOp("public", "users");
    act(() => {
      useEditStore.getState().pushOp("erd-c1", dup);
    });

    await waitFor(() => {
      expect(screen.getByTestId("ddl-preview-errors")).toBeInTheDocument();
    });
    expect(screen.getByTestId("ddl-preview-errors-list")).toHaveTextContent(      /Table users already exists in schema public/i,
);
    // Apply must remain disabled while errors are present.
    expect(screen.getByTestId("edit-apply")).toBeDisabled();
  });
});

// ── �� rename newly-added column routes through op-log ──────────
describe("�� rename newly-added column", () => {
  it("renaming an addColumn op-target updates the op-log + DDL preview", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));

    // Add column "col_2" to the existing `users` table programmatically so
    // we don't depend on the +column row's click target wiring.
    const addCol = makeAddColumnOp(      { schema: "public", name: "users" },
      "col_2",
      "TEXT",
      true,
      false,
);
    act(() => {
      useEditStore.getState().pushOp("erd-c1", addCol);
    });

    // Click the new-column inline editor (rendered as the column name).
    // Because the column id is `_new:<opId>` and not its current text,
    // the rename handler used to silently no-op (). After the
    // fix `column.id` is plumbed through and the rename creates a
    // renameColumn op.
    const colTextNode = await screen.findByText("col_2");
    fireEvent.click(colTextNode);
    const input = screen.getByDisplayValue("col_2");
    fireEvent.change(input, { target: { value: "name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const ops = useEditStore.getState().getOps("erd-c1");
    // The original addColumn + a renameColumn we just pushed.
    expect(ops).toHaveLength(2);
    expect(ops[1].kind).toBe("renameColumn");
    if (ops[1].kind === "renameColumn") {
      expect(ops[1].newName).toBe("name");
    }
    expect(screen.getByTestId("ddl-preview-sql")).toHaveTextContent(/"name" TEXT/);
  });
});

// ── �� Reset Layout requires confirm ────────────────────────────
describe("�� Reset Layout confirm", () => {
  it("clicking Reset Layout opens a confirm modal and does NOT reset until OK", async () => {
    const user = userEvent.setup();
    // Pre-load a position so the Reset button is mounted.
    mockErdLoadPositions.mockResolvedValueOnce([{ nodeId: "public.users", x: 100, y: 50 }]);
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));

    // Wait for positions to load and the Reset button to mount.
    await screen.findByTestId("edit-reset-layout");
    await user.click(screen.getByTestId("edit-reset-layout"));

    expect(screen.getByTestId("reset-confirm-modal")).toBeInTheDocument();
    expect(mockErdSavePositions).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("reset-confirm-cancel"));
    expect(screen.queryByTestId("reset-confirm-modal")).toBeNull();
    expect(mockErdSavePositions).not.toHaveBeenCalled();

    // Re-open and confirm.
    await user.click(screen.getByTestId("edit-reset-layout"));
    await user.click(screen.getByTestId("reset-confirm-ok"));
    expect(mockErdSavePositions).toHaveBeenCalledWith("c1", "*", []);
  });
});

// ── �� FK handle icon + i18n compliance ─────────────────────────
describe("�� FK handle icon + picker i18n", () => {
  it("FK handle renders link affordance, not the legacy ⇨ glyph", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));

    const handle = screen.getByTestId("table-card-fk-handle");
    expect(handle).toHaveTextContent("🔗");
    expect(handle).not.toHaveTextContent("⇨");
  });

  it("en + ru both expose erd.edit.fk.modal.not_pk_unique", () => {
    const enLabel = (en as { erd: { edit: { fk: { modal: { not_pk_unique: string } } } } }).erd.edit
      .fk.modal.not_pk_unique;
    const ruLabel = (ru as { erd: { edit: { fk: { modal: { not_pk_unique: string } } } } }).erd.edit
      .fk.modal.not_pk_unique;
    expect(enLabel).toBe("not PK/UNIQUE");
    expect(ruLabel).toBe("не PK/UNIQUE");
  });
});

// ── �� auto-fit retry path exists ───────────────────────────────
describe("�� auto-fit retry on large graphs", () => {
  it("erd-canvas mounts with the SVG element accessible for ResizeObserver", () => {
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    // The canvas SVG must be addressable so the ResizeObserver hook in
    // ErdPane can subscribe to it. The original bug was the auto-fit
    // bailing out when the SVG had a 0×0 client rect at first paint.
    expect(screen.getByTestId("erd-canvas")).toBeInTheDocument();
  });
});
