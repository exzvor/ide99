// — DomainTypeEditor smoke tests (B3.7).

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
import { DomainTypeEditor } from "./DomainTypeEditor";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "domain_type", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("DomainTypeEditor", () => {
  it("renders empty form for create mode", () => {
    render(<DomainTypeEditor tab={createTab()} />);
    expect(screen.getByTestId("domain-type-editor")).toBeInTheDocument();
    expect((screen.getByTestId("domain-schema") as HTMLInputElement).value).toBe("public");
  });

  it("name + baseType produces CREATE DOMAIN preview", () => {
    render(<DomainTypeEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("domain-name"), { target: { value: "us_zip" } });
    fireEvent.change(screen.getByTestId("domain-base-type"), { target: { value: "text" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE DOMAIN");
    expect(sql).toContain("us_zip");
    expect(sql).toContain("AS text");
  });

  it("toggling NOT NULL emits NOT NULL clause", () => {
    render(<DomainTypeEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("domain-name"), { target: { value: "us_zip" } });
    fireEvent.change(screen.getByTestId("domain-base-type"), { target: { value: "text" } });
    fireEvent.click(screen.getByTestId("domain-not-null"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("NOT NULL");
  });

  it("adding a CHECK constraint emits ALTER DOMAIN … ADD CHECK", () => {
    render(<DomainTypeEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("domain-name"), { target: { value: "us_zip" } });
    fireEvent.change(screen.getByTestId("domain-base-type"), { target: { value: "text" } });
    fireEvent.click(screen.getByTestId("domain-constraints-add"));
    fireEvent.change(screen.getByTestId("domain-constraint-0-check"), {
      target: { value: "VALUE ~ '^[0-9]{5}$'" },
    });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toMatch(/ALTER DOMAIN.*ADD.*CHECK/);
  });
});
