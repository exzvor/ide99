// — IndexEditor tests (B3.T2).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { IndexDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetIndexDefinition: vi.fn(),
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

vi.mock("../../pgvector/extensionProbe", () => ({
  isPgvectorInstalled: vi.fn().mockResolvedValue(false),
  _clearPgvectorProbeCache: vi.fn(),
}));

import { schemaGetIndexDefinition } from "../../../lib/tauri";
import { useObjectEditorStore } from "../store";
import { IndexEditor } from "./index";

const mockedGet = schemaGetIndexDefinition as unknown as ReturnType<typeof vi.fn>;

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: {
      objectKind: "index",
      mode: "create",
      schema: "public",
      parentTable: "users",
      ...overrides,
    },
    createdAt: new Date(0).toISOString(),
  };
}

const SAMPLE: IndexDefinition = {
  schema: "public",
  name: "users_email_idx",
  table: "users",
  method: "btree",
  unique: true,
  primary: false,
  columns: ["email"],
  include: [],
  predicate: null,
  definition: "CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)",
};

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
  mockedGet.mockReset();
});

describe("IndexEditor", () => {
  it("mounts in create mode with a blank form", () => {
    render(<IndexEditor tab={createTab()} />);
    expect(screen.getByTestId("index-editor")).toBeInTheDocument();
    expect((screen.getByTestId("index-name") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("index-table") as HTMLInputElement).value).toBe("users");
  });

  it("mounts in edit mode and populates from definition", async () => {
    mockedGet.mockResolvedValue(SAMPLE);
    render(<IndexEditor tab={createTab({ mode: "edit", name: "users_email_idx" })} />);
    await waitFor(() => expect(screen.getByTestId("index-editor")).toBeInTheDocument());
    expect((screen.getByTestId("index-name") as HTMLInputElement).value).toBe("users_email_idx");
    expect((screen.getByTestId("index-unique") as HTMLInputElement).checked).toBe(true);
  });

  it("changing method in edit mode shows recreate warning banner", async () => {
    mockedGet.mockResolvedValue(SAMPLE);
    render(<IndexEditor tab={createTab({ mode: "edit", name: "users_email_idx" })} />);
    await waitFor(() => expect(screen.getByTestId("index-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("index-method-hash"));
    await waitFor(() => {
      expect(screen.getByTestId("index-recreate-warning")).toBeInTheDocument();
    });
  });

  it("toggling unique updates the DDL preview", () => {
    render(<IndexEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("index-name"), { target: { value: "ix1" } });
    fireEvent.change(screen.getByTestId("index-col-expr-0"), { target: { value: "id" } });
    fireEvent.click(screen.getByTestId("index-unique"));
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql.toUpperCase()).toContain("UNIQUE INDEX");
  });

  it("Apply button is enabled with valid form (name, table, expr)", () => {
    render(<IndexEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("index-name"), { target: { value: "ix1" } });
    fireEvent.change(screen.getByTestId("index-col-expr-0"), { target: { value: "id" } });
    const applyBtn = screen.getByTestId("object-editor-apply") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
  });

  it("Apply button stays disabled when name/table/expr blank", () => {
    render(<IndexEditor tab={createTab({ parentTable: undefined })} />);
    const applyBtn = screen.getByTestId("object-editor-apply") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });
});

describe("S26 — vector index wizard integration", () => {
  it("renders the wizard button and opens the wizard when pgvector is installed", async () => {
    const probe = await import("../../pgvector/extensionProbe");
    vi.spyOn(probe, "isPgvectorInstalled").mockResolvedValue(true);
    probe._clearPgvectorProbeCache();
    render(<IndexEditor tab={createTab()} />);
    const button = await screen.findByTestId("index-vector-wizard-button");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByTestId("vector-index-wizard")).toBeInTheDocument();
  });

  it("hides the wizard button when pgvector is not installed", async () => {
    const probe = await import("../../pgvector/extensionProbe");
    vi.spyOn(probe, "isPgvectorInstalled").mockResolvedValue(false);
    probe._clearPgvectorProbeCache();
    render(<IndexEditor tab={createTab()} />);
    await waitFor(() => {
      expect(screen.queryByTestId("index-vector-wizard-button")).not.toBeInTheDocument();
    });
  });
});
