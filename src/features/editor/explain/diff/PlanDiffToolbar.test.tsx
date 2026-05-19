import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../../i18n";
import { __testing, useEditor } from "../../store";
import { PlanDiffToolbar } from "./PlanDiffToolbar";

vi.mock("../../../../lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../lib/tauri")>("../../../../lib/tauri");
  return {
    ...actual,
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
    recentPlansGet: vi.fn().mockResolvedValue(null),
  };
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => __testing.reset());
afterEach(() => vi.clearAllMocks());

describe("PlanDiffToolbar", () => {
  it("renders both side labels and Swap / Open A / Open B buttons", () => {
    render(
      <PlanDiffToolbar
        tabId="plan-diff-x"
        left={{ kind: "recent", recentPlanId: "rA" }}
        right={{ kind: "recent", recentPlanId: "rB" }}
        leftLabel="ANALYZE · 04-29 14:02 · 142ms"
        rightLabel="ANALYZE · 04-29 14:18 · 3ms"
      />,
    );
    expect(screen.getByTestId("plan-diff-left-label").textContent).toContain("142ms");
    expect(screen.getByTestId("plan-diff-right-label").textContent).toContain("3ms");
    expect(screen.getByTestId("plan-diff-swap")).toBeTruthy();
    expect(screen.getByTestId("plan-diff-open-a")).toBeTruthy();
    expect(screen.getByTestId("plan-diff-open-b")).toBeTruthy();
  });

  it("Swap calls swapPlanDiff(tabId)", () => {
    const spy = vi.spyOn(useEditor.getState(), "swapPlanDiff").mockImplementation(() => {});
    render(
      <PlanDiffToolbar
        tabId="plan-diff-y"
        left={{ kind: "recent", recentPlanId: "rA" }}
        right={{ kind: "recent", recentPlanId: "rB" }}
        leftLabel="A"
        rightLabel="B"
      />,
    );
    fireEvent.click(screen.getByTestId("plan-diff-swap"));
    expect(spy).toHaveBeenCalledWith("plan-diff-y");
  });

  it("Open A on a recent side routes through openEditorFromRecent", () => {
    const recentSpy = vi
      .spyOn(useEditor.getState(), "openEditorFromRecent")
      .mockResolvedValue(undefined);
    render(
      <PlanDiffToolbar
        tabId="plan-diff-z"
        left={{ kind: "recent", recentPlanId: "rA" }}
        right={{ kind: "recent", recentPlanId: "rB" }}
        leftLabel="A"
        rightLabel="B"
      />,
    );
    fireEvent.click(screen.getByTestId("plan-diff-open-a"));
    expect(recentSpy).toHaveBeenCalledWith("rA");
  });

  it("Open B on a runtime side routes through openEditorTab with prefillSql", () => {
    const editorSpy = vi.spyOn(useEditor.getState(), "openEditorTab").mockImplementation(() => {
      return {
        id: "stub",
        kind: "editor",
        name: "untitled-1",
        content: "",
        connectionId: null,
        cursorPos: { line: 1, col: 1 },
        dirty: false,
        createdAt: "",
        updatedAt: "",
      };
    });
    render(
      <PlanDiffToolbar
        tabId="plan-diff-z"
        left={{ kind: "recent", recentPlanId: "rA" }}
        right={{
          kind: "runtime",
          planJson: [{}],
          sql: "SELECT 42",
          connectionId: "conn-1",
          executedAt: "2026-04-29T14:18:00Z",
          durationMs: 3,
          mode: "analyze",
          optionsJson: "{}",
        }}
        leftLabel="A"
        rightLabel="B"
      />,
    );
    fireEvent.click(screen.getByTestId("plan-diff-open-b"));
    expect(editorSpy).toHaveBeenCalledWith("conn-1", { prefillSql: "SELECT 42" });
  });
});
