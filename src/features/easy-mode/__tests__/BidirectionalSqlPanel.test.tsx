import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryShape } from "../../../lib/parser";
import { useEditor } from "../../editor/store";
import { BidirectionalSqlPanel } from "../BidirectionalSqlPanel";
import { useUiMode } from "../store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const baseShape: QueryShape = {
  baseSelect: { schema: null, table: "users", columns: ["*"] },
  filters: [],
  sort: null,
  limit: null,
  unrepresentableTail: null,
  whereSpan: null,
  orderBySpan: null,
  limitSpan: null,
  fromEnd: 0,
};

function setActiveShape(tabId: string, shape: QueryShape | null): void {
  const map = new Map(useEditor.getState().queryShapes);
  if (shape === null) map.delete(tabId);
  else map.set(tabId, shape);
  useEditor.setState({ activeTabId: tabId, queryShapes: map });
}

describe("BidirectionalSqlPanel", () => {
  beforeEach(() => {
    useUiMode.setState({ mode: "easy", tourCompleted: true });
    useEditor.setState({ activeTabId: null, queryShapes: new Map() });
  });
  afterEach(() => {
    useUiMode.setState({ mode: "standard", tourCompleted: false });
    useEditor.setState({ activeTabId: null, queryShapes: new Map() });
  });

  it("returns null in Standard mode", () => {
    useUiMode.setState({ mode: "standard", tourCompleted: false });
    const { container } = render(<BidirectionalSqlPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders empty body when no active shape", () => {
    render(<BidirectionalSqlPanel />);
    const body = screen.getByTestId("bidi-sql-panel-body");
    expect(body.textContent).toBe("");
  });

  it("renders SQL from the active tab's queryShape", () => {
    setActiveShape("t1", baseShape);
    render(<BidirectionalSqlPanel />);
    const body = screen.getByTestId("bidi-sql-panel-body");
    expect(body.textContent).toContain("SELECT *");
    expect(body.textContent).toContain(`FROM "users"`);
  });

  it("respects sql prop override", () => {
    setActiveShape("t1", baseShape);
    render(<BidirectionalSqlPanel sql="-- override" />);
    expect(screen.getByTestId("bidi-sql-panel-body").textContent).toBe("-- override");
  });

  it("collapses on toggle click", async () => {
    setActiveShape("t1", baseShape);
    const user = userEvent.setup();
    render(<BidirectionalSqlPanel />);
    expect(screen.getByTestId("bidi-sql-panel")).toHaveAttribute("data-collapsed", "false");
    await user.click(screen.getByTestId("bidi-sql-panel-toggle"));
    expect(screen.getByTestId("bidi-sql-panel")).toHaveAttribute("data-collapsed", "true");
  });

  it("flashes data-changed-recently when WHERE filters change", async () => {
    vi.useFakeTimers();
    try {
      setActiveShape("t1", baseShape);
      const { rerender } = render(<BidirectionalSqlPanel />);
      // Mutate the shape so the WHERE signature changes.
      const next: QueryShape = {
        ...baseShape,
        filters: [{ column: "id", op: "eq", value: 1 }],
      };
      act(() => setActiveShape("t1", next));
      rerender(<BidirectionalSqlPanel />);
      expect(screen.getByTestId("bidi-sql-panel")).toHaveAttribute("data-changed-recently", "true");
      // Pulse clears after 2s.
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      rerender(<BidirectionalSqlPanel />);
      expect(screen.getByTestId("bidi-sql-panel")).not.toHaveAttribute("data-changed-recently");
    } finally {
      vi.useRealTimers();
    }
  });
});
