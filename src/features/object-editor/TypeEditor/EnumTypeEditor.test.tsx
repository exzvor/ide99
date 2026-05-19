// — EnumTypeEditor smoke tests (B3.5).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetCustomTypeDefinition: vi.fn(),
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

import { useObjectEditorStore } from "../store";
import { EnumTypeEditor } from "./EnumTypeEditor";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "enum_type", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("EnumTypeEditor", () => {
  it("renders empty form with schema prefilled to public", () => {
    render(<EnumTypeEditor tab={createTab()} />);
    expect(screen.getByTestId("enum-type-editor")).toBeInTheDocument();
    expect((screen.getByTestId("enum-schema") as HTMLInputElement).value).toBe("public");
  });

  it("empty form (no values) → empty preview", () => {
    render(<EnumTypeEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("enum-name"), { target: { value: "color" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE TYPE");
    expect(sql).toContain("AS ENUM ()");
  });

  it("3 values → CREATE TYPE preview lists all values", () => {
    render(<EnumTypeEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("enum-name"), { target: { value: "color" } });
    for (const v of ["red", "green", "blue"]) {
      fireEvent.click(screen.getByTestId("enum-values-add"));
      const idx = screen.getAllByTestId(/^enum-value-\d+$/).length - 1;
      fireEvent.change(screen.getByTestId(`enum-value-${idx}-input`), { target: { value: v } });
    }
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("'red'");
    expect(sql).toContain("'green'");
    expect(sql).toContain("'blue'");
  });

  it("adding a value via UI updates the values list", () => {
    render(<EnumTypeEditor tab={createTab()} />);
    fireEvent.click(screen.getByTestId("enum-values-add"));
    fireEvent.click(screen.getByTestId("enum-values-add"));
    expect(screen.getAllByTestId(/^enum-value-\d+$/)).toHaveLength(2);
  });
});
