// — CompositeTypeEditor smoke tests (B3.6).

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
    useEditor: Object.assign(      (selector: (s: { closeTab: typeof closeTab }) => unknown) => selector({ closeTab }),
      { getState: () => ({ closeTab }) },
),
  };
});

import { useObjectEditorStore } from "../store";
import { CompositeTypeEditor } from "./CompositeTypeEditor";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "composite_type", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("CompositeTypeEditor", () => {
  it("renders empty form for create mode", () => {
    render(<CompositeTypeEditor tab={createTab()} />);
    expect(screen.getByTestId("composite-type-editor")).toBeInTheDocument();
    expect((screen.getByTestId("composite-schema") as HTMLInputElement).value).toBe("public");
  });

  it("typing name + adding 2 fields produces CREATE TYPE … AS (…)", () => {
    render(<CompositeTypeEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("composite-name"), { target: { value: "addr" } });
    fireEvent.click(screen.getByTestId("composite-fields-add"));
    fireEvent.change(screen.getByTestId("composite-field-0-name"), { target: { value: "city" } });
    fireEvent.change(screen.getByTestId("composite-field-0-type"), { target: { value: "text" } });
    fireEvent.click(screen.getByTestId("composite-fields-add"));
    fireEvent.change(screen.getByTestId("composite-field-1-name"), { target: { value: "zip" } });
    fireEvent.change(screen.getByTestId("composite-field-1-type"), { target: { value: "text" } });

    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE TYPE");
    expect(sql).toContain("addr");
    expect(sql).toContain("city");
    expect(sql).toContain("zip");
  });

  it("Add field button increments field rows", () => {
    render(<CompositeTypeEditor tab={createTab()} />);
    fireEvent.click(screen.getByTestId("composite-fields-add"));
    fireEvent.click(screen.getByTestId("composite-fields-add"));
    expect(screen.getAllByTestId(/^composite-field-\d+$/)).toHaveLength(2);
  });
});
