// — FdwServerEditor smoke tests (B3.1).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetFdwServerDefinition: vi.fn(),
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
import { FdwServerEditor } from "./index";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "fdw_server", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("FdwServerEditor", () => {
  it("renders empty form for create mode", () => {
    render(<FdwServerEditor tab={createTab()} />);
    expect(screen.getByTestId("fdw-server-editor")).toBeInTheDocument();
    expect(screen.getByTestId("fdw-name")).toBeInTheDocument();
    expect(screen.getByTestId("fdw-fdw-name")).toBeInTheDocument();
  });

  it("typing name + fdw produces CREATE SERVER preview", () => {
    render(<FdwServerEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("fdw-name"), { target: { value: "srv1" } });
    fireEvent.change(screen.getByTestId("fdw-fdw-name"), {
      target: { value: "postgres_fdw" },
    });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE SERVER");
    expect(sql).toContain("srv1");
    expect(sql).toContain("postgres_fdw");
  });

  it("Add option button increments option row count", () => {
    render(<FdwServerEditor tab={createTab()} />);
    fireEvent.click(screen.getByTestId("fdw-options-add"));
    fireEvent.click(screen.getByTestId("fdw-options-add"));
    expect(screen.getByTestId("fdw-option-0")).toBeInTheDocument();
    expect(screen.getByTestId("fdw-option-1")).toBeInTheDocument();
  });

  it("Add user mapping creates a card with role + nested options", () => {
    render(<FdwServerEditor tab={createTab()} />);
    fireEvent.click(screen.getByTestId("fdw-mappings-add"));
    const card = screen.getByTestId("fdw-mapping-0");
    expect(within(card).getByTestId("fdw-mapping-0-role")).toBeInTheDocument();
    expect(within(card).getByTestId("fdw-mapping-0-options-add")).toBeInTheDocument();
  });
});
