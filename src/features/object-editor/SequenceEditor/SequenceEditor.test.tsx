// — SequenceEditor tests (B3.T5).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetSequenceDefinition: vi.fn(),
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
import { SequenceEditor } from "./index";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "sequence", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("SequenceEditor", () => {
  it("mounts in create mode with PG defaults (bigint, increment 1, no cycle)", () => {
    render(<SequenceEditor tab={createTab()} />);
    expect(screen.getByTestId("sequence-editor")).toBeInTheDocument();
    expect((screen.getByTestId("sequence-data-type") as HTMLSelectElement).value).toBe("bigint");
    expect((screen.getByTestId("sequence-increment") as HTMLInputElement).value).toBe("1");
    expect((screen.getByTestId("sequence-cycle") as HTMLInputElement).checked).toBe(false);
  });

  it("changing data type reflects in DDL preview", () => {
    render(<SequenceEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("sequence-name"), { target: { value: "s1" } });
    fireEvent.change(screen.getByTestId("sequence-data-type"), {
      target: { value: "integer" },
    });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE SEQUENCE");
    expect(sql).toContain("AS integer");
  });

  it("toggling cycle emits CYCLE in preview", () => {
    render(<SequenceEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("sequence-name"), { target: { value: "s1" } });
    fireEvent.click(screen.getByTestId("sequence-cycle"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CYCLE");
  });

  it("non-default cache emits CACHE n in preview", () => {
    render(<SequenceEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("sequence-name"), { target: { value: "s1" } });
    fireEvent.change(screen.getByTestId("sequence-cache"), { target: { value: "20" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CACHE 20");
  });
});
