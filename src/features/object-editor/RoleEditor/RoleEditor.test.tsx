// — RoleEditor smoke tests (B3.4).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetRoleDefinition: vi.fn(),
    schemaListRoles: vi.fn().mockResolvedValue([]),
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
import { RoleEditor } from "./index";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "role", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("RoleEditor", () => {
  it("renders all 7 attribute toggles in create mode", () => {
    render(<RoleEditor tab={createTab()} />);
    expect(screen.getByTestId("role-editor")).toBeInTheDocument();
    for (const attr of [
      "login",
      "superuser",
      "createdb",
      "createrole",
      "replication",
      "bypassrls",
      "inherit",
    ]) {
      expect(screen.getByTestId(`role-attr-${attr}`)).toBeInTheDocument();
    }
  });

  it("typing name produces CREATE ROLE preview with default attrs (LOGIN, INHERIT)", () => {
    render(<RoleEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("role-name"), { target: { value: "alice" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE ROLE");
    expect(sql).toContain("alice");
    expect(sql).toContain("LOGIN");
    expect(sql).toContain("INHERIT");
    expect(sql).toContain("CONNECTION LIMIT -1");
  });

  it("toggling superuser flips that attribute in DDL preview", () => {
    render(<RoleEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("role-name"), { target: { value: "alice" } });
    fireEvent.click(screen.getByTestId("role-attr-superuser"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toMatch(/\bSUPERUSER\b/);
    expect(sql).not.toMatch(/\bNOSUPERUSER\b/);
  });

  it("entering password emits PASSWORD clause + visible warning", () => {
    render(<RoleEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("role-name"), { target: { value: "alice" } });
    fireEvent.change(screen.getByTestId("role-password"), { target: { value: "s3cret" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("PASSWORD");
    expect(sql).toContain("s3cret");
    const warnings = screen.getByTestId("object-editor-ddl-warnings");
    expect(warnings.textContent ?? "").toMatch(/password/i);
  });
});
