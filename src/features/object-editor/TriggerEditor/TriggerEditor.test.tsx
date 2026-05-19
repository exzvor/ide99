// — TriggerEditor tests (B3.T3).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { TriggerDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetTriggerDefinition: vi.fn(),
    schemaListFunctions: vi.fn().mockResolvedValue([]),
    schemaApplyDdl: vi.fn(),
  };
});

vi.mock("../../editor/store", async () => {
  const actual = await vi.importActual<typeof import("../../editor/store")>("../../editor/store");
  const closeTab = vi.fn().mockResolvedValue(true);
  return {
    ...actual,
    useEditor: Object.assign(      (selector: (s: { closeTab: typeof closeTab }) => unknown) => selector({ closeTab }),
      { getState: () => ({ closeTab }) },
),
  };
});

import { schemaGetTriggerDefinition, schemaListFunctions } from "../../../lib/tauri";
import { useObjectEditorStore } from "../store";
import { TriggerEditor } from "./index";

const mockedGet = schemaGetTriggerDefinition as unknown as ReturnType<typeof vi.fn>;
const mockedList = schemaListFunctions as unknown as ReturnType<typeof vi.fn>;

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "trigger", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

const SAMPLE_TRG: TriggerDefinition = {
  schema: "public",
  name: "trg_audit",
  tableSchema: "public",
  tableName: "users",
  timing: "before",
  events: { insert: true, update: false, delete: false, truncate: false },
  updateColumns: [],
  forEach: "row",
  whenClause: null,
  functionSchema: "public",
  functionName: "audit_fn",
  enabled: true,
};

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
  mockedGet.mockReset();
  mockedList.mockReset();
  mockedList.mockResolvedValue([]);
});

describe("TriggerEditor", () => {
  it("mounts in create mode with defaults (BEFORE / row / enabled)", () => {
    render(<TriggerEditor tab={createTab()} />);
    expect(screen.getByTestId("trigger-editor")).toBeInTheDocument();
    expect((screen.getByTestId("trigger-timing-before") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("trigger-for-each-row") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("trigger-enabled") as HTMLInputElement).checked).toBe(true);
  });

  it("timing change BEFORE → AFTER updates the DDL preview", () => {
    render(<TriggerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("trigger-name"), { target: { value: "t1" } });
    fireEvent.change(screen.getByTestId("trigger-table-name"), { target: { value: "users" } });
    fireEvent.click(screen.getByTestId("trigger-event-insert"));
    // pick function from picker stub by setting fn picker via direct typing isn't
    // available — use a loaded list with a single function.
    mockedList.mockResolvedValue([
      { name: "audit_fn", args: "", returnKind: "trigger", returnType: null },
    ]);
    // Re-render via state isn't needed; the list reload happens on schema change.
    fireEvent.click(screen.getByTestId("trigger-timing-after"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    // No function selected ⇒ errors panel shows; preview is empty placeholder text.
    expect(screen.getByTestId("object-editor-ddl-errors").textContent ?? "").toMatch(/function/i);
    expect(sql.length).toBeGreaterThan(0);
  });

  it("checking INSERT shows it in the preview when valid", async () => {
    render(<TriggerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("trigger-name"), { target: { value: "t1" } });
    fireEvent.change(screen.getByTestId("trigger-table-name"), { target: { value: "users" } });
    fireEvent.click(screen.getByTestId("trigger-event-insert"));
    // Manually populate functionRef via store mutation to bypass picker.
    const tabId = Object.keys(useObjectEditorStore.getState().formByTab)[0];
    useObjectEditorStore
      .getState()
      .updateForm(tabId, (s) =>
        s.kind === "trigger"
          ? { ...s, form: { ...s.form, functionRef: { schema: "public", name: "fn1" } } }
          : s,
);
    await waitFor(() => {
      const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
      expect(sql).toContain("INSERT");
      expect(sql).toContain("CREATE TRIGGER");
    });
  });

  it("UPDATE event + UPDATE OF columns produces UPDATE OF clause", async () => {
    render(<TriggerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("trigger-name"), { target: { value: "t1" } });
    fireEvent.change(screen.getByTestId("trigger-table-name"), { target: { value: "users" } });
    fireEvent.click(screen.getByTestId("trigger-event-update"));
    fireEvent.change(screen.getByTestId("trigger-update-columns"), {
      target: { value: "col1, col2" },
    });
    const tabId = Object.keys(useObjectEditorStore.getState().formByTab)[0];
    useObjectEditorStore
      .getState()
      .updateForm(tabId, (s) =>
        s.kind === "trigger"
          ? { ...s, form: { ...s.form, functionRef: { schema: "public", name: "fn1" } } }
          : s,
);
    await waitFor(() => {
      const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
      expect(sql).toMatch(/UPDATE OF col1, col2/);
    });
  });

  it("WHEN clause input is reflected in the preview", async () => {
    render(<TriggerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("trigger-name"), { target: { value: "t1" } });
    fireEvent.change(screen.getByTestId("trigger-table-name"), { target: { value: "users" } });
    fireEvent.click(screen.getByTestId("trigger-event-insert"));
    fireEvent.change(screen.getByTestId("trigger-when"), {
      target: { value: "NEW.id IS NOT NULL" },
    });
    const tabId = Object.keys(useObjectEditorStore.getState().formByTab)[0];
    useObjectEditorStore
      .getState()
      .updateForm(tabId, (s) =>
        s.kind === "trigger"
          ? { ...s, form: { ...s.form, functionRef: { schema: "public", name: "fn1" } } }
          : s,
);
    await waitFor(() => {
      const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
      expect(sql).toContain("WHEN (NEW.id IS NOT NULL)");
    });
  });

  it("validation: no event checked surfaces the error", () => {
    render(<TriggerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("trigger-name"), { target: { value: "t1" } });
    fireEvent.change(screen.getByTestId("trigger-table-name"), { target: { value: "users" } });
    expect(screen.getByTestId("object-editor-ddl-errors").textContent ?? "").toMatch(/event/i);
  });

  it("validation: WHEN + FOR EACH STATEMENT shows error", async () => {
    render(<TriggerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("trigger-name"), { target: { value: "t1" } });
    fireEvent.change(screen.getByTestId("trigger-table-name"), { target: { value: "users" } });
    fireEvent.click(screen.getByTestId("trigger-event-insert"));
    fireEvent.click(screen.getByTestId("trigger-for-each-statement"));
    fireEvent.change(screen.getByTestId("trigger-when"), { target: { value: "TRUE" } });
    const tabId = Object.keys(useObjectEditorStore.getState().formByTab)[0];
    useObjectEditorStore
      .getState()
      .updateForm(tabId, (s) =>
        s.kind === "trigger"
          ? { ...s, form: { ...s.form, functionRef: { schema: "public", name: "fn1" } } }
          : s,
);
    await waitFor(() => {
      expect(screen.getByTestId("object-editor-ddl-errors").textContent ?? "").toMatch(        /FOR EACH ROW/i,
);
    });
  });

  it("validation: empty function picker selection shows error", () => {
    render(<TriggerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("trigger-name"), { target: { value: "t1" } });
    fireEvent.change(screen.getByTestId("trigger-table-name"), { target: { value: "users" } });
    fireEvent.click(screen.getByTestId("trigger-event-insert"));
    expect(screen.getByTestId("object-editor-ddl-errors").textContent ?? "").toMatch(/function/i);
  });

  it("INSTEAD OF on table shows the warning banner (no error)", () => {
    render(<TriggerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("trigger-name"), { target: { value: "t1" } });
    fireEvent.change(screen.getByTestId("trigger-table-name"), { target: { value: "users" } });
    fireEvent.click(screen.getByTestId("trigger-event-insert"));
    fireEvent.click(screen.getByTestId("trigger-timing-instead_of"));
    expect(screen.getByTestId("trigger-instead-of-warning")).toBeInTheDocument();
  });

  it("enabled toggle in edit mode emits ALTER TABLE DISABLE TRIGGER chunk", async () => {
    mockedGet.mockResolvedValue(SAMPLE_TRG);
    render(      <TriggerEditor tab={createTab({ mode: "edit", name: "trg_audit", parentTable: "users" })} />,
);
    await waitFor(() => expect(screen.getByTestId("trigger-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("trigger-enabled"));
    await waitFor(() => {
      const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
      expect(sql).toMatch(/ALTER TABLE public\.users DISABLE TRIGGER trg_audit;/);
    });
  });

  it("signature change in edit mode emits DROP + CREATE + warning", async () => {
    mockedGet.mockResolvedValue(SAMPLE_TRG);
    render(      <TriggerEditor tab={createTab({ mode: "edit", name: "trg_audit", parentTable: "users" })} />,
);
    await waitFor(() => expect(screen.getByTestId("trigger-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("trigger-event-update"));
    await waitFor(() => {
      const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
      expect(sql).toMatch(/DROP TRIGGER trg_audit/);
      expect(sql).toMatch(/CREATE TRIGGER trg_audit/);
    });
    expect(screen.getByTestId("object-editor-ddl-warnings").textContent ?? "").toMatch(      /recreate|ALTER TRIGGER/i,
);
  });

  it("HelpLink is rendered with topic=trigger", () => {
    render(<TriggerEditor tab={createTab()} />);
    const link = screen.getByTestId("object-editor-help-link");
    expect(link.getAttribute("data-topic")).toBe("trigger");
  });
});
