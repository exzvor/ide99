// — SubscriptionEditor smoke tests (B3.3).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import type { ObjectEditorTab as TabModel } from "../../editor/store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetSubscriptionDefinition: vi.fn(),
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
import { SubscriptionEditor } from "./index";

function createTab(overrides: Partial<TabModel["target"]> = {}): TabModel {
  return {
    id: `tab-${Math.random().toString(36).slice(2)}`,
    kind: "object-editor",
    connectionId: "conn-1",
    target: { objectKind: "subscription", mode: "create", schema: "public", ...overrides },
    createdAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  useObjectEditorStore.setState({ formByTab: {}, applyByTab: {} });
});

describe("SubscriptionEditor", () => {
  it("renders editor with conninfo password warning visible", () => {
    render(<SubscriptionEditor tab={createTab()} />);
    expect(screen.getByTestId("subscription-editor")).toBeInTheDocument();
    expect(screen.getByTestId("sub-conninfo-warning")).toBeInTheDocument();
    expect(screen.getByTestId("sub-conninfo")).toBeInTheDocument();
  });

  it("typing name + conninfo + publications produces CREATE SUBSCRIPTION preview", () => {
    render(<SubscriptionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("sub-name"), { target: { value: "sub1" } });
    fireEvent.change(screen.getByTestId("sub-conninfo"), {
      target: { value: "host=src dbname=app user=rep password=secret" },
    });
    fireEvent.change(screen.getByTestId("sub-publications"), { target: { value: "pub1" } });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("CREATE SUBSCRIPTION");
    expect(sql).toContain("sub1");
    expect(sql).toContain("CONNECTION");
    expect(sql).toContain("password=secret");
  });

  it("toggling enabled flips its checkbox state", () => {
    render(<SubscriptionEditor tab={createTab()} />);
    const enabled = screen.getByTestId("sub-enabled") as HTMLInputElement;
    expect(enabled.checked).toBe(true);
    fireEvent.click(enabled);
    expect(enabled.checked).toBe(false);
  });

  it("publications input parses comma-separated values", () => {
    render(<SubscriptionEditor tab={createTab()} />);
    fireEvent.change(screen.getByTestId("sub-name"), { target: { value: "sub1" } });
    fireEvent.change(screen.getByTestId("sub-conninfo"), { target: { value: "host=src" } });
    fireEvent.change(screen.getByTestId("sub-publications"), {
      target: { value: "pub_a, pub_b" },
    });
    const sql = screen.getByTestId("object-editor-ddl-preview-sql").textContent ?? "";
    expect(sql).toContain("pub_a");
    expect(sql).toContain("pub_b");
  });
});
