// — ViewEditor tests (B3.T3).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetViewDefinition: vi.fn(),
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

import { schemaGetViewDefinition } from "../../../lib/tauri";
import { useObjectEditorStore } from "../store";
import { ViewEditor } from "./index";

const mockedGet = schemaGetViewDefinition as unknown as ReturnType<typeof vi.fn>;

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: {
      objectKind: "view",
      mode: "create",
      schema: "public",
      ...overrides,
    },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
  mockedGet.mockReset();
});

describe("ViewEditor", () => {
  it("mounts in edit mode and populates body", async () => {
    mockedGet.mockResolvedValue({
      schema: "public",
      name: "v1",
      body: "SELECT 1",
      comment: null,
    });
    render(<ViewEditor tab={createTab({ mode: "edit", name: "v1" })} />);
    await waitFor(() => expect(screen.getByTestId("view-editor")).toBeInTheDocument());
    expect((screen.getByTestId("view-name") as HTMLInputElement).value).toBe("v1");
    expect((screen.getByTestId("view-body") as HTMLTextAreaElement).value).toBe("SELECT 1");
  });

  it("typing into the body updates the DDL preview", () => {
    render(<ViewEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("view-name"), { target: { value: "v2" } });
    fireEvent.change(screen.getByTestId("view-body"), {
      target: { value: "SELECT 1 AS x" },
    });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE OR REPLACE VIEW");
    expect(sql).toContain("SELECT 1 AS x");
  });

  it("renders HelpLink with topic=view", () => {
    render(<ViewEditor tab={createTab()} />);
    const link = screen.getByTestId("object-editor-help-link");
    expect(link.getAttribute("data-topic")).toBe("view");
  });

  it("Apply button enabled only when name + body present", () => {
    render(<ViewEditor tab={createTab()} />);
    const btn = screen.getByTestId("object-editor-apply") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("view-name"), { target: { value: "v" } });
    fireEvent.change(screen.getByTestId("view-body"), { target: { value: "SELECT 1" } });
    expect(btn.disabled).toBe(false);
  });
});
