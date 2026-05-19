// — RangeTypeEditor smoke tests (B3.8).

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
import { RangeTypeEditor } from "./RangeTypeEditor";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "range_type", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("RangeTypeEditor", () => {
  it("renders empty form for create mode", () => {
    render(<RangeTypeEditor tab={createTab()} />);
    expect(screen.getByTestId("range-type-editor")).toBeInTheDocument();
    expect((screen.getByTestId("range-schema") as HTMLInputElement).value).toBe("public");
  });

  it("name + subtype produces CREATE TYPE … AS RANGE preview", () => {
    render(<RangeTypeEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("range-name"), { target: { value: "intrange" } });
    fireEvent.change(screen.getByTestId("range-subtype"), { target: { value: "integer" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE TYPE");
    expect(sql).toContain("intrange");
    expect(sql).toContain("AS RANGE");
    expect(sql).toContain("subtype = integer");
  });

  it("filling subtype_opclass adds it to the WITH list", () => {
    render(<RangeTypeEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("range-name"), { target: { value: "intrange" } });
    fireEvent.change(screen.getByTestId("range-subtype"), { target: { value: "integer" } });
    fireEvent.change(screen.getByTestId("range-subtype-opclass"), {
      target: { value: "int4_ops" },
    });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("subtype_opclass = int4_ops");
  });
});
