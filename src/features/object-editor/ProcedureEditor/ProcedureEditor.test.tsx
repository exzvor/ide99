// — ProcedureEditor tests (B3.T2).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ProcedureDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetProcedureDefinition: vi.fn(),
    schemaApplyDdl: vi.fn(),
  };
});

vi.mock("../../editor/store", async () => {
  const actual = await vi.importActual<typeof import("../../editor/store")>("../../editor/store");
  const closeTab = vi.fn().mockResolvedValue(true);
  return {
    ...actual,
    useEditor: Object.assign(
      (selector: (s: { closeTab: typeof closeTab }) => unknown) => selector({ closeTab }),
      { getState: () => ({ closeTab }) },
    ),
  };
});

import { schemaGetProcedureDefinition } from "../../../lib/tauri";
import { useObjectEditorStore } from "../store";
import { ProcedureEditor } from "./index";

const mockedGet = schemaGetProcedureDefinition as unknown as ReturnType<typeof vi.fn>;

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "procedure", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

const SAMPLE_PROC: ProcedureDefinition = {
  schema: "public",
  name: "do_thing",
  language: "plpgsql",
  parameters: [{ name: "x", mode: "in", typeText: "integer", default: null }],
  body: "BEGIN PERFORM 1; END",
  securityDefiner: false,
  comment: null,
};

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
  mockedGet.mockReset();
});

describe("ProcedureEditor", () => {
  it("mounts in create mode with PG defaults (plpgsql, no security definer)", () => {
    render(<ProcedureEditor tab={createTab()} />);
    expect(screen.getByTestId("procedure-editor")).toBeInTheDocument();
    expect((screen.getByTestId("proc-language") as HTMLSelectElement).value).toBe("plpgsql");
    expect((screen.getByTestId("proc-security-definer") as HTMLInputElement).checked).toBe(false);
  });

  it("body change is reflected in DDL preview", () => {
    render(<ProcedureEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("proc-name"), { target: { value: "p1" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "PERFORM 99" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE OR REPLACE PROCEDURE");
    expect(sql).toContain("PERFORM 99");
  });

  it("toggling SECURITY DEFINER emits the clause in preview", () => {
    render(<ProcedureEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("proc-name"), { target: { value: "p1" } });
    fireEvent.change(screen.getByTestId("fn-body-textarea"), { target: { value: "PERFORM 1" } });
    fireEvent.click(screen.getByTestId("proc-security-definer"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("SECURITY DEFINER");
  });

  it("signature change in edit mode emits DROP + CREATE + warning", async () => {
    mockedGet.mockResolvedValue(SAMPLE_PROC);
    render(
      <ProcedureEditor
        tab={createTab({ mode: "edit", name: "do_thing", parentTable: "integer" })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("procedure-editor")).toBeInTheDocument());
    // Change parameter type to trigger signature change.
    const typeInput = screen.getAllByTestId(/^proc-param-type-/)[0] as HTMLInputElement;
    fireEvent.change(typeInput, { target: { value: "bigint" } });
    await waitFor(() => {
      const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
      expect(sql).toMatch(/DROP PROCEDURE/);
      expect(sql).toMatch(/CREATE OR REPLACE PROCEDURE/);
    });
    expect(screen.getByTestId("object-editor-ddl-warnings").textContent ?? "").toMatch(
      /signature/i,
    );
  });

  it("HelpLink is rendered with topic=procedure", () => {
    render(<ProcedureEditor tab={createTab()} />);
    const link = screen.getByTestId("object-editor-help-link");
    expect(link.getAttribute("data-topic")).toBe("procedure");
  });
});
