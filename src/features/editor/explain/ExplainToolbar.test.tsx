import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../i18n";
import { type ExplainTab, __testing, useEditor } from "../store";
import { ExplainToolbar } from "./ExplainToolbar";

// Stub the Tauri bridge so the underlying store actions don't try to touch
// real IPC during tests. We only care that the toolbar dispatches into the
// store — actual side-effects (re-running, cancelling) are B2's territory.
vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    queryExplain: vi.fn().mockResolvedValue({ planJson: [], durationMs: 1, statusMessage: "" }),
    queryExplainCancel: vi.fn().mockResolvedValue(undefined),
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
    recentPlansGet: vi.fn().mockResolvedValue(null),
    recentPlansSearch: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  };
});

beforeEach(() => __testing.reset());
afterEach(() => vi.clearAllMocks());

const makeTab = (over: Partial<ExplainTab["options"]> = {}): ExplainTab => ({
  id: "explain-x",
  kind: "explain",
  sourceTabId: "x",
  options: { mode: "analyze", verbose: false, wal: false, timing: true, ...over },
  createdAt: "",
});

describe("ExplainToolbar", () => {
  it("renders mode badge + 3 toggles", () => {
    render(<ExplainToolbar tab={makeTab()} isRunning={false} />);
    expect(screen.getByTestId("explain-mode-badge").textContent).toBe("EXPLAIN ANALYZE");
    expect(screen.getByTestId("explain-toggle-verbose")).toBeTruthy();
    expect(screen.getByTestId("explain-toggle-wal")).toBeTruthy();
    expect(screen.getByTestId("explain-toggle-timing")).toBeTruthy();
  });

  it("toggle changes options but does NOT auto-rerun", async () => {
    // Spy to make sure no queryExplain fires from a toggle. The toolbar
    // calls toggleExplainOption directly; the only way it could fire a
    // query is if the store's toggle action chained into runExplain.
    const tauri = await import("../../../lib/tauri");
    const queryExplainSpy = vi.mocked(tauri.queryExplain);

    // Stub the store's toggleExplainOption with a behavior-correct shim
    // so we can observe its invocation independently of B2's real impl.
    const tab = makeTab();
    useEditor.setState({ tabs: [tab] });
    const toggleSpy = vi
      .spyOn(useEditor.getState(), "toggleExplainOption")
      .mockImplementation((tabId, key) => {
        useEditor.setState((s) => ({
          tabs: s.tabs.map((x) =>
            x.id === tabId && x.kind === "explain"
              ? { ...x, options: { ...x.options, [key]: !x.options[key] } }
              : x,
),
        }));
      });

    render(<ExplainToolbar tab={tab} isRunning={false} />);
    const verboseCheckbox = screen
      .getByTestId("explain-toggle-verbose")
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(verboseCheckbox);

    expect(toggleSpy).toHaveBeenCalledWith("explain-x", "verbose");
    expect(queryExplainSpy).not.toHaveBeenCalled();

    const updated = useEditor.getState().tabs[0] as ExplainTab;
    expect(updated.options.verbose).toBe(true);
  });

  it("greys out WAL/TIMING for plain EXPLAIN mode", () => {
    render(<ExplainToolbar tab={makeTab({ mode: "explain" })} isRunning={false} />);
    const wal = screen
      .getByTestId("explain-toggle-wal")
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    const timing = screen
      .getByTestId("explain-toggle-timing")
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    const verbose = screen
      .getByTestId("explain-toggle-verbose")
      .querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(wal.disabled).toBe(true);
    expect(timing.disabled).toBe(true);
    // Verbose is meaningful for plain EXPLAIN too — must stay enabled.
    expect(verbose.disabled).toBe(false);
  });

  it("isRunning=true shows Cancel and hides Re-run", () => {
    const { rerender } = render(<ExplainToolbar tab={makeTab()} isRunning={false} />);
    expect(screen.queryByTestId("explain-rerun")).toBeTruthy();
    expect(screen.queryByTestId("explain-cancel")).toBeNull();

    rerender(<ExplainToolbar tab={makeTab()} isRunning={true} />);
    expect(screen.queryByTestId("explain-rerun")).toBeNull();
    expect(screen.queryByTestId("explain-cancel")).toBeTruthy();
  });

  describe("cached recent-plan tab", () => {
    const cachedTab: ExplainTab = {
      id: "explain-cached-r1",
      kind: "explain",
      sourceTabId: null,
      cachedRecentPlanId: "r1",
      options: { mode: "explain", verbose: false, wal: false, timing: false },
      createdAt: "",
    };

    it("cached → Re-run disabled with tooltip", () => {
      render(<ExplainToolbar tab={cachedTab} isRunning={false} />);
      const rerun = screen.getByTestId("explain-rerun") as HTMLButtonElement;
      expect(rerun.disabled).toBe(true);
      // Tooltip is locale-dependent (RU is the default in tests). Just assert
      // it's set non-empty so we know the title prop survived rendering.
      const title = rerun.getAttribute("title") ?? "";
      expect(title.length).toBeGreaterThan(0);
    });

    it("cached → Open SQL button visible", () => {
      render(<ExplainToolbar tab={cachedTab} isRunning={false} />);
      expect(screen.getByTestId("explain-open-sql")).toBeTruthy();
    });

    it("cached → toggle pills disabled", () => {
      render(<ExplainToolbar tab={cachedTab} isRunning={false} />);
      for (const key of ["verbose", "wal", "timing"] as const) {
        const input = screen
          .getByTestId(`explain-toggle-${key}`)
          .querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(input.disabled).toBe(true);
      }
    });
  });

  describe("[Diff with…] button ", () => {
    function seedReady(): import("../store").ExplainTab {
      const tab: import("../store").ExplainTab = {
        id: "explain-x",
        kind: "explain",
        sourceTabId: "x",
        options: { mode: "analyze", verbose: false, wal: false, timing: true },
        createdAt: "",
      };
      useEditor.setState({
        tabs: [
          {
            id: "x",
            kind: "editor",
            name: "untitled-1",
            content: "",
            connectionId: "c1",
            cursorPos: { line: 1, col: 1 },
            dirty: false,
            createdAt: "",
            updatedAt: "",
          },
          tab,
        ],
        explainRunStates: new Map([
          [
            tab.id,
            {
              status: "ready" as const,
              plan: [{}],
              durationMs: 1,
              statusMessage: "",
              ranAt: 0,
              executedSql: "SELECT 1",
            },
          ],
        ]),
      });
      return tab;
    }

    it("hidden in idle / running / error / cancelled states", () => {
      const tab = makeTab();
      // Idle: no entry in explainRunStates
      const { rerender } = render(<ExplainToolbar tab={tab} isRunning={false} />);
      expect(screen.queryByTestId("explain-diff-with")).toBeNull();

      // Running
      useEditor.setState({
        explainRunStates: new Map([
          [tab.id, { status: "running" as const, startedAt: 0, cancelable: true }],
        ]),
      });
      rerender(<ExplainToolbar tab={tab} isRunning={true} />);
      expect(screen.queryByTestId("explain-diff-with")).toBeNull();

      // Error
      useEditor.setState({
        explainRunStates: new Map([[tab.id, { status: "error" as const, code: "postgres_error" }]]),
      });
      rerender(<ExplainToolbar tab={tab} isRunning={false} />);
      expect(screen.queryByTestId("explain-diff-with")).toBeNull();

      // Cancelled
      useEditor.setState({
        explainRunStates: new Map([[tab.id, { status: "cancelled" as const }]]),
      });
      rerender(<ExplainToolbar tab={tab} isRunning={false} />);
      expect(screen.queryByTestId("explain-diff-with")).toBeNull();
    });

    it("visible in ready and click opens picker modal", async () => {
      const tab = seedReady();
      render(<ExplainToolbar tab={tab} isRunning={false} />);
      const btn = screen.getByTestId("explain-diff-with");
      expect(btn).toBeTruthy();

      // No modal yet
      expect(screen.queryByTestId("recent-plans-picker-modal")).toBeNull();
      fireEvent.click(btn);
      // The picker mounts asynchronously after the connection lookup.
      await new Promise((r) => setTimeout(r, 5));
      expect(screen.queryByTestId("recent-plans-picker-modal")).toBeTruthy();
    });
  });
});
