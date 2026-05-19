// — PublicationEditor smoke tests (B3.2).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetPublicationDefinition: vi.fn(),
    schemaListPublishableTables: vi.fn().mockResolvedValue([]),
    schemaListSchemas: vi.fn().mockResolvedValue([]),
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
import { PublicationEditor } from "./index";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "publication", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("PublicationEditor", () => {
  it("renders empty form for create mode (mode=all_tables default)", () => {
    render(<PublicationEditor tab={createTab()} />);
    expect(screen.getByTestId("publication-editor")).toBeInTheDocument();
    expect((screen.getByTestId("pub-mode-all_tables") as HTMLInputElement).checked).toBe(true);
  });

  it("typing name produces FOR ALL TABLES preview", () => {
    render(<PublicationEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("pub-name"), { target: { value: "pub1" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE PUBLICATION");
    expect(sql).toContain("FOR ALL TABLES");
    expect(sql).toContain("pub1");
  });

  it("switching to schemas mode updates target clause", () => {
    render(<PublicationEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("pub-name"), { target: { value: "pub1" } });
    fireEvent.click(screen.getByTestId("pub-mode-schemas"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("FOR TABLES IN SCHEMA");
  });

  it("toggling publish_insert off updates DDL preview", () => {
    render(<PublicationEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("pub-name"), { target: { value: "pub1" } });
    fireEvent.click(screen.getByTestId("pub-op-insert"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    // With insert OFF the publish list is no longer the all-default value, so
    // a `WITH (publish = '...')` clause should appear that excludes 'insert'.
    expect(sql).toContain("publish");
    expect(sql).not.toMatch(/publish *= *'insert/);
  });
});
