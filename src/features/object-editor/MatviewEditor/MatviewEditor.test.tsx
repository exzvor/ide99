// — MatviewEditor tests (B3.T4).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetMatviewDefinition: vi.fn(),
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

import { schemaGetMatviewDefinition } from "../../../lib/tauri";
import { useObjectEditorStore } from "../store";
import { MatviewEditor } from "./index";

const mockedGet = schemaGetMatviewDefinition as unknown as ReturnType<typeof vi.fn>;

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "matview", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
  mockedGet.mockReset();
});

describe("MatviewEditor", () => {
  it("mounts in edit mode populated=true", async () => {
    mockedGet.mockResolvedValue({
      schema: "public",
      name: "mv1",
      body: "SELECT 1",
      populated: true,
      comment: null,
    });
    render(<MatviewEditor tab={createTab({ mode: "edit", name: "mv1" })} />);
    await waitFor(() => expect(screen.getByTestId("matview-editor")).toBeInTheDocument());
    expect((screen.getByTestId("matview-with-data") as HTMLInputElement).checked).toBe(true);
  });

  it("toggling WITH DATA flips form value", () => {
    render(<MatviewEditor tab={createTab()} />);
    const cb = screen.getByTestId("matview-with-data") as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
  });

  it("body change in edit mode shows recreate-warning banner", async () => {
    mockedGet.mockResolvedValue({
      schema: "public",
      name: "mv1",
      body: "SELECT 1",
      populated: true,
      comment: null,
    });
    render(<MatviewEditor tab={createTab({ mode: "edit", name: "mv1" })} />);
    await waitFor(() => expect(screen.getByTestId("matview-editor")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("matview-body"), {
      target: { value: "SELECT 2" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("matview-recreate-warning")).toBeInTheDocument();
    });
  });

  it("renders HelpLink with topic=matview", () => {
    render(<MatviewEditor tab={createTab()} />);
    expect(screen.getByTestId("object-editor-help-link").getAttribute("data-topic")).toBe(      "matview",
);
  });
});
