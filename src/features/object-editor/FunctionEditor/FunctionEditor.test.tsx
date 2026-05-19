// — FunctionEditor tests (B3.T1).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { FunctionDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetFunctionDefinition: vi.fn(),
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

import { schemaGetFunctionDefinition } from "../../../lib/tauri";
import { useObjectEditorStore } from "../store";
import { FunctionEditor } from "./index";

const mockedGet = schemaGetFunctionDefinition as unknown as ReturnType<typeof vi.fn>;

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "function", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

const SAMPLE_FN: FunctionDefinition = {
  schema: "public",
  name: "add",
  language: "sql",
  parameters: [
    { name: "a", mode: "in", typeText: "integer", default: null },
    { name: "b", mode: "in", typeText: "integer", default: null },
  ],
  returnKind: "scalar",
  returnType: "integer",
  body: "SELECT a + b",
  volatility: "volatile",
  parallelSafety: "unsafe",
  securityDefiner: false,
  cost: null,
  estimatedRows: null,
  comment: null,
};

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
  mockedGet.mockReset();
});

describe("FunctionEditor", () => {
  it("mounts in create mode with a blank form", () => {
    render(<FunctionEditor tab={createTab()} />);
    expect(screen.getByTestId("function-editor")).toBeInTheDocument();
    expect((screen.getByTestId("fn-schema") as HTMLInputElement).value).toBe("public");
    expect((screen.getByTestId("fn-name") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("fn-language") as HTMLSelectElement).value).toBe("plpgsql");
  });

  it("mounts in edit mode and populates the form from invoke", async () => {
    mockedGet.mockResolvedValue(SAMPLE_FN);
    render(      <FunctionEditor
        tab={createTab({ mode: "edit", name: "add", parentTable: "integer, integer" })}
      />,
);
    await waitFor(() => expect(screen.getByTestId("function-editor")).toBeInTheDocument());
    expect(mockedGet).toHaveBeenCalledWith("conn-1", "public", "add", "integer, integer");
    expect((screen.getByTestId("fn-name") as HTMLInputElement).value).toBe("add");
    expect((screen.getByTestId("fn-language") as HTMLSelectElement).value).toBe("sql");
  });

  it("adding a parameter row shows up + reflects in DDL preview", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "f1" } });
    fireEvent.change(screen.getByTestId("fn-return-type-input"), { target: { value: "integer" } });
    // Provide body so DDL becomes valid (not strictly needed for this assertion).
    const body = screen.getByTestId("fn-body-textarea") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "SELECT 1;" } });
    fireEvent.click(screen.getByTestId("fn-param-add"));
    const rows = screen.getAllByTestId(/^fn-param-row-/);
    expect(rows.length).toBe(1);
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE OR REPLACE FUNCTION");
  });

  it("deleting a parameter row updates the preview", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "f1" } });
    fireEvent.change(screen.getByTestId("fn-return-type-input"), { target: { value: "integer" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByTestId("fn-param-add"));
    const row = screen.getAllByTestId(/^fn-param-row-/)[0];
    const id = (row.getAttribute("data-testid") ?? "").replace("fn-param-row-", "");
    fireEvent.click(screen.getByTestId(`fn-param-remove-${id}`));
    expect(screen.queryAllByTestId(/^fn-param-row-/).length).toBe(0);
  });

  it("changing language updates the DDL preview", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "f1" } });
    fireEvent.change(screen.getByTestId("fn-return-type-input"), { target: { value: "integer" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "SELECT 1" } });
    fireEvent.change(screen.getByTestId("fn-language"), { target: { value: "sql" } });
    let sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql.toLowerCase()).toContain("language sql");
    fireEvent.change(screen.getByTestId("fn-language"), { target: { value: "plpgsql" } });
    sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql.toLowerCase()).toContain("language plpgsql");
  });

  it("body change is reflected in the DDL preview", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "f1" } });
    fireEvent.change(screen.getByTestId("fn-return-type-input"), { target: { value: "integer" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), {
      target: { value: "SELECT 42" },
    });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("SELECT 42");
  });

  it("toggling SECURITY DEFINER emits the clause in preview", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "f1" } });
    fireEvent.change(screen.getByTestId("fn-return-type-input"), { target: { value: "integer" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByTestId("fn-security-definer"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("SECURITY DEFINER");
  });

  it("validation: empty name shows the error chip", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "SELECT 1" } });
    const errors = screen.getByTestId("object-editor-ddl-errors");
    expect(errors.textContent ?? "").toMatch(/name/i);
  });

  it("validation: duplicate parameter name shows error", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "f" } });
    fireEvent.change(screen.getByTestId("fn-return-type-input"), { target: { value: "integer" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByTestId("fn-param-add"));
    fireEvent.click(screen.getByTestId("fn-param-add"));
    const rows = screen.getAllByTestId(/^fn-param-row-/);
    const ids = rows.map((r) => (r.getAttribute("data-testid") ?? "").replace("fn-param-row-", ""));
    fireEvent.change(screen.getByTestId(`fn-param-name-${ids[0]}`), { target: { value: "x" } });
    fireEvent.change(screen.getByTestId(`fn-param-name-${ids[1]}`), { target: { value: "x" } });
    const errors = screen.getByTestId("object-editor-ddl-errors");
    expect(errors.textContent ?? "").toMatch(/duplicate/i);
  });

  it("validation: VARIADIC not last shows error", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "f" } });
    fireEvent.change(screen.getByTestId("fn-return-type-input"), { target: { value: "integer" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByTestId("fn-param-add"));
    fireEvent.click(screen.getByTestId("fn-param-add"));
    const rows = screen.getAllByTestId(/^fn-param-row-/);
    const firstId = (rows[0].getAttribute("data-testid") ?? "").replace("fn-param-row-", "");
    fireEvent.change(screen.getByTestId(`fn-param-mode-${firstId}`), {
      target: { value: "variadic" },
    });
    const errors = screen.getByTestId("object-editor-ddl-errors");
    expect(errors.textContent ?? "").toMatch(/variadic/i);
  });

  it("HelpLink is rendered with topic=function", () => {
    render(<FunctionEditor tab={createTab()} />);
    const link = screen.getByTestId("object-editor-help-link");
    expect(link.getAttribute("data-topic")).toBe("function");
  });

  it("dirty close-guard: changing a field flips the dirty badge", async () => {
    mockedGet.mockResolvedValue(SAMPLE_FN);
    render(      <FunctionEditor
        tab={createTab({ mode: "edit", name: "add", parentTable: "integer, integer" })}
      />,
);
    await waitFor(() => expect(screen.getByTestId("function-editor")).toBeInTheDocument());
    expect(screen.queryByTestId("fn-dirty-badge")).toBeNull();
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "add2" } });
    await waitFor(() => expect(screen.getByTestId("fn-dirty-badge")).toBeInTheDocument());
  });

  it("'other' language renders the yellow warning banner", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-language"), { target: { value: "other" } });
    expect(screen.getByTestId("fn-body-language-warning")).toBeInTheDocument();
  });

  it("returnKind=trigger hides the return-type input", () => {
    render(<FunctionEditor tab={createTab()} />);
    expect(screen.getByTestId("fn-return-type-input")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fn-return-kind-trigger"));
    expect(screen.queryByTestId("fn-return-type-input")).toBeNull();
  });

  it("cost null → no COST in preview; cost 50 → COST 50 in preview", () => {
    render(<FunctionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "f" } });
    fireEvent.change(screen.getByTestId("fn-return-type-input"), { target: { value: "integer" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "SELECT 1" } });
    let sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).not.toMatch(/\bCOST\b/);
    fireEvent.change(screen.getByTestId("fn-cost"), { target: { value: "50" } });
    sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toMatch(/COST 50/);
  });
});
