/**
 * — ErdPane edit-mode integration test.
 *
 * Covers the happy path acceptance criteria from `02-sprints.md`:
 * - Toggle edit mode via the Edit button
 * - "+ New table" pushes an `addTable` op
 * - DDL preview panel mounts and reflects pending ops
 * - Apply → confirm → schemaApplyDdl IPC invoked → ops cleared on success
 * - Undo rolls back the ops
 *
 * Uses the same mock pattern as `ErdPane.test.tsx`: stub the data-fetch hook
 * (`useErdGraph`), the layout function (so rendering is deterministic), and
 * the editor store. New for S19: stub `schemaApplyDdl` + `erd*Positions` IPC
 * wrappers.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErdSchemaGraph } from "../../lib/tauri";
import type { ErdLoadState } from "./store";

// ── i18n ────────────────────────────────────────────────────────────────────

const FAKE_DICT: Record<string, string> = {
  "erd.edit.toggle.label": "Edit mode",
  "erd.edit.toggle.tooltip": "Edit schema",
  "erd.edit.new_table": "+ New table",
  "erd.edit.apply": "Apply",
  "erd.edit.discard": "Discard",
  "erd.edit.undo": "Undo",
  "erd.edit.redo": "Redo",
  "erd.edit.preview.title": "DDL preview",
  "erd.edit.preview.statement_count": "{{n}} statements",
  "erd.edit.preview.empty": "No pending changes",
  "erd.edit.confirm.apply.title": "Apply schema changes?",
  "erd.edit.confirm.apply.body": "{{n}} statements to {{conn}}",
  "erd.edit.confirm.discard.title": "Discard schema edits?",
  "erd.edit.confirm.discard.body": "{{n}} unapplied changes",
  "erd.edit.toast.apply_success": "Schema updated ({{n}}, {{ms}}ms)",
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

// ── Store + layout mocks (same shape as ErdPane.test.tsx) ───────────────────

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
        height: 60,
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

// Toast: useToast() returns dispatchers; stub each.
vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

// Polyfills for Radix.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

import { ErdPane } from "./ErdPane";
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

describe("ErdPane edit-mode happy path", () => {
  it("toggle edit → +new table → ddl preview appears", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    expect(screen.queryByTestId("ddl-preview-panel")).toBeNull();

    await user.click(screen.getByTestId("edit-toggle"));
    expect(useEditStore.getState().getMode("erd-c1")).toBe("edit");
    expect(screen.getByTestId("ddl-preview-panel")).toBeInTheDocument();

    await user.click(screen.getByTestId("edit-new-table"));
    expect(useEditStore.getState().getOps("erd-c1")).toHaveLength(1);
    expect(screen.getByTestId("ddl-preview-sql")).toHaveTextContent(/CREATE TABLE/);
  });

  it("apply success clears ops + invokes schemaApplyDdl", async () => {
    const user = userEvent.setup();
    mockSchemaApplyDdl.mockResolvedValue({ statementsExecuted: 1, durationMs: 5 });

    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));
    await user.click(screen.getByTestId("edit-new-table"));
    await user.click(screen.getByTestId("edit-apply"));
    expect(screen.getByTestId("apply-confirm-modal")).toBeInTheDocument();

    await user.click(screen.getByTestId("apply-confirm-ok"));
    expect(mockSchemaApplyDdl).toHaveBeenCalledWith("c1", expect.stringContaining("CREATE TABLE"));
    // Ops cleared on success.
    expect(useEditStore.getState().getOps("erd-c1")).toEqual([]);
    expect(screen.queryByTestId("apply-confirm-modal")).toBeNull();
  });

  // + when lastChangeBy === "text", Apply must send the
  // verbatim user-typed script (preserves order, comments, unrepresentable
  // statements) — NOT the regenerated DDL.
  it("apply uses verbatim lastReverseText when text-edit is the most recent change", async () => {
    const user = userEvent.setup();
    mockSchemaApplyDdl.mockResolvedValue({ statementsExecuted: 2, durationMs: 8 });

    // Simulate the user typing a manual script in the DDL panel: one
    // representable statement + one ordering-sensitive comment block.
    const manualScript =
      "CREATE TABLE foo (id int);\n-- preserve this comment\nCREATE INDEX idx_foo ON foo (id);";
    const { makeAddTableOp } = await import("./edit/ops");
    useEditStore.getState().replaceOpsFromAst(
      "erd-c1",
      // Default seedColumns (single id PK) — keeps validateOps happy so
      // Apply isn't gated by no-columns error.
      [makeAddTableOp("public", "foo")],
      [{ message: "Index DDL not supported" }],
      manualScript,
    );

    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));
    await user.click(screen.getByTestId("edit-apply"));
    await user.click(screen.getByTestId("apply-confirm-ok"));
    expect(mockSchemaApplyDdl).toHaveBeenCalledWith("c1", manualScript);
  });

  it("undo rolls back the +new table op", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));
    await user.click(screen.getByTestId("edit-new-table"));
    expect(useEditStore.getState().getOps("erd-c1")).toHaveLength(1);

    await user.click(screen.getByTestId("edit-undo"));
    expect(useEditStore.getState().getOps("erd-c1")).toEqual([]);
    expect(screen.getByTestId("ddl-preview-sql")).toHaveTextContent(/No pending changes/);
  });

  it("apply error renders error banner with PG code + message", async () => {
    const user = userEvent.setup();
    mockSchemaApplyDdl.mockRejectedValue({
      failingStatementIndex: 0,
      failingSql: 'CREATE TABLE "public"."new_table_1" (...);',
      pgErrorCode: "42P07",
      pgMessage: "relation already exists",
      pgHint: null,
    });

    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));
    await user.click(screen.getByTestId("edit-new-table"));
    await user.click(screen.getByTestId("edit-apply"));
    await user.click(screen.getByTestId("apply-confirm-ok"));

    expect(screen.getByTestId("ddl-preview-error")).toHaveTextContent("42P07");
    expect(screen.getByTestId("ddl-preview-error")).toHaveTextContent("relation already exists");
    // Ops preserved on error.
    expect(useEditStore.getState().getOps("erd-c1")).toHaveLength(1);
  });
});
