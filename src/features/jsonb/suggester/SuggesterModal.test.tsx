/**
 * — SuggesterModal component tests.
 *
 * Covers:
 * - All 5 graceful-degradation quadrants from spec §7.1 (speedup section visibility).
 * - Collapsing/expanding "Estimated speedup" triggers IPC at most once.
 * - [Copy SQL] calls clipboard.
 * - [Open in editor] calls openEditorTab and closes the modal.
 * - axe: 0 violations.
 */

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HypoPgEstimate, SuggesterResult } from "../../../lib/tauri";
import { SuggesterModal } from "./SuggesterModal";

expect.extend(toHaveNoViolations);

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return Object.entries(vars).reduce<string>((acc, [k, v]) => {
        return acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
      }, key);
    },
  }),
}));

const mockJsonbSuggesterRun = vi.fn<() => Promise<SuggesterResult>>();
const mockJsonbSuggesterHypotheticalExplain = vi.fn<() => Promise<HypoPgEstimate>>();

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    jsonbSuggesterRun: (...args: unknown[]) => mockJsonbSuggesterRun(...(args as [])),
    jsonbSuggesterHypotheticalExplain: (...args: unknown[]) =>
      mockJsonbSuggesterHypotheticalExplain(...(args as [])),
  };
});

const mockOpenEditorTab = vi.fn();
vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab: mockOpenEditorTab }),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_FQN = { schema: "public", table: "events", column: "data" };
const BASE_SQL =
  "CREATE INDEX CONCURRENTLY idx_events_data_gin ON public.events USING GIN (data jsonb_path_ops);";

function makeResult(overrides?: Partial<SuggesterResult>): SuggesterResult {
  return {
    extensions: {
      pgStatStatements: { kind: "available" },
      hypopg: { kind: "available" },
      genericPlan: true,
    },
    suggestions: [
      {
        schema: "public",
        table: "events",
        column: "data",
        opClass: { kind: "jsonbPathOps" },
        recommendedSql: BASE_SQL,
        indexName: "idx_events_data_gin",
        rationale: {
          kind: "mined",
          calls: 1243,
          totalExecTimeMs: 8400,
          opsSeen: ["@>", "@?"],
        },
        estimatedSizeBytes: 89_128_960,
        representativeQuery: "SELECT * FROM events WHERE data @> $1",
      },
    ],
    generatedAt: Date.now(),
    ...overrides,
  };
}

function renderModal(open = true) {
  const onClose = vi.fn();
  const { container, unmount } = render(    <SuggesterModal open={open} connId="c1" fqn={BASE_FQN} onClose={onClose} />,
);
  return { container, unmount, onClose };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SuggesterModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: write to clipboard succeeds
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders null when not open", () => {
    const { container } = render(      <SuggesterModal open={false} connId="c1" fqn={BASE_FQN} onClose={vi.fn()} />,
);
    expect(container.firstChild).toBeNull();
  });

  it("shows loading state while fetching", () => {
    // Never resolve
    mockJsonbSuggesterRun.mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(screen.getByTestId("suggester-loading")).toBeInTheDocument();
  });

  it("shows recommendation SQL after successful fetch", async () => {
    mockJsonbSuggesterRun.mockResolvedValue(makeResult());
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("suggester-recommended-sql")).toBeInTheDocument(),
);
    expect(screen.getByTestId("suggester-recommended-sql").textContent).toContain(      "idx_events_data_gin",
);
  });

  it("shows error state and retry button on fetch failure", async () => {
    mockJsonbSuggesterRun.mockRejectedValue(new Error("connection failed"));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("suggester-error")).toBeInTheDocument());
    expect(screen.getByTestId("suggester-retry-btn")).toBeInTheDocument();
  });

  it("retries fetch on retry button click", async () => {
    mockJsonbSuggesterRun
      .mockRejectedValueOnce(new Error("first fail"))
      .mockResolvedValue(makeResult());
    renderModal();
    await waitFor(() => screen.getByTestId("suggester-retry-btn"));
    fireEvent.click(screen.getByTestId("suggester-retry-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("suggester-recommended-sql")).toBeInTheDocument(),
);
    expect(mockJsonbSuggesterRun).toHaveBeenCalledTimes(2);
  });

  // ── Graceful-degradation matrix ──────────────────────────────────────────

  describe("§7.1 graceful-degradation quadrants", () => {
    it("Q1: pg_stat_statements=✅ hypopg=✅ PG≥16 — speedup section visible with full feature", async () => {
      mockJsonbSuggesterRun.mockResolvedValue(makeResult());
      mockJsonbSuggesterHypotheticalExplain.mockResolvedValue({
        kind: "computed",
        baselineCost: 1500,
        hypotheticalCost: 200,
        reductionPct: 86.7,
      });
      renderModal();
      await waitFor(() => screen.getByTestId("suggester-speedup-details"));
      // Expand the speedup section
      fireEvent.click(screen.getByTestId("suggester-speedup-summary"));
      await waitFor(() => screen.getByTestId("hypopg-computed"));
      expect(screen.getByTestId("hypopg-computed")).toBeInTheDocument();
    });

    it("Q2: pg_stat_statements=✅ hypopg=✅ PG<16 — speedup shows pgTooOld", async () => {
      mockJsonbSuggesterRun.mockResolvedValue(        makeResult({
          extensions: {
            pgStatStatements: { kind: "available" },
            hypopg: { kind: "available" },
            genericPlan: false,
          },
        }),
);
      mockJsonbSuggesterHypotheticalExplain.mockResolvedValue({
        kind: "unavailable",
        reason: { kind: "pgVersionTooOld", actual: "15.2", required: "16" },
      });
      renderModal();
      await waitFor(() => screen.getByTestId("suggester-speedup-details"));
      fireEvent.click(screen.getByTestId("suggester-speedup-summary"));
      await waitFor(() => screen.getByTestId("hypopg-unavailable-pgTooOld"));
      expect(screen.getByTestId("hypopg-unavailable-pgTooOld")).toBeInTheDocument();
    });

    it("Q3: pg_stat_statements=✅ hypopg=❌ — speedup shows hypopgMissing", async () => {
      mockJsonbSuggesterRun.mockResolvedValue(        makeResult({
          extensions: {
            pgStatStatements: { kind: "available" },
            hypopg: {
              kind: "unavailable",
              installSql: "CREATE EXTENSION hypopg;",
            },
            genericPlan: true,
          },
        }),
);
      mockJsonbSuggesterHypotheticalExplain.mockResolvedValue({
        kind: "unavailable",
        reason: { kind: "extensionMissing" },
      });
      renderModal();
      await waitFor(() => screen.getByTestId("suggester-speedup-details"));
      fireEvent.click(screen.getByTestId("suggester-speedup-summary"));
      await waitFor(() => screen.getByTestId("hypopg-unavailable-extensionMissing"));
      expect(screen.getByTestId("hypopg-unavailable-extensionMissing")).toBeInTheDocument();
      expect(screen.getByTestId("hypopg-install-sql")).toBeInTheDocument();
    });

    it("Q4: pg_stat_statements=❌ hypopg=✅ — generic rationale, speedup shows noRepresentativeQuery", async () => {
      mockJsonbSuggesterRun.mockResolvedValue(        makeResult({
          extensions: {
            pgStatStatements: {
              kind: "unavailable",
              installSql: "CREATE EXTENSION pg_stat_statements;",
            },
            hypopg: { kind: "available" },
            genericPlan: true,
          },
          suggestions: [
            {
              schema: "public",
              table: "events",
              column: "data",
              opClass: { kind: "jsonbOps" },
              recommendedSql: BASE_SQL,
              indexName: "idx_events_data_gin",
              rationale: { kind: "generic" },
              estimatedSizeBytes: null,
              representativeQuery: null,
            },
          ],
        }),
);
      mockJsonbSuggesterHypotheticalExplain.mockResolvedValue({
        kind: "unavailable",
        reason: { kind: "noRepresentativeQuery" },
      });
      renderModal();
      await waitFor(() => screen.getByTestId("suggester-rationale-generic"));
      expect(screen.getByTestId("suggester-rationale-generic")).toBeInTheDocument();
      // Size estimate should be hidden (estimatedSizeBytes is null)
      expect(screen.queryByTestId("suggester-size-estimate")).not.toBeInTheDocument();
      // Representative query section should be hidden
      expect(screen.queryByTestId("suggester-representative-query")).not.toBeInTheDocument();
      // Expand speedup
      fireEvent.click(screen.getByTestId("suggester-speedup-summary"));
      await waitFor(() => screen.getByTestId("hypopg-unavailable-noRepresentativeQuery"));
      expect(screen.getByTestId("hypopg-unavailable-noRepresentativeQuery")).toBeInTheDocument();
    });

    it("Q5: pg_stat_statements=❌ hypopg=❌ — generic rationale, no size, noRepresentativeQuery speedup", async () => {
      mockJsonbSuggesterRun.mockResolvedValue(        makeResult({
          extensions: {
            pgStatStatements: {
              kind: "unavailable",
              installSql: "CREATE EXTENSION pg_stat_statements;",
            },
            hypopg: {
              kind: "unavailable",
              installSql: "CREATE EXTENSION hypopg;",
            },
            genericPlan: false,
          },
          suggestions: [
            {
              schema: "public",
              table: "events",
              column: "data",
              opClass: { kind: "jsonbOps" },
              recommendedSql: BASE_SQL,
              indexName: "idx_events_data_gin",
              rationale: { kind: "generic" },
              estimatedSizeBytes: null,
              representativeQuery: null,
            },
          ],
        }),
);
      mockJsonbSuggesterHypotheticalExplain.mockResolvedValue({
        kind: "unavailable",
        reason: { kind: "noRepresentativeQuery" },
      });
      renderModal();
      await waitFor(() => screen.getByTestId("suggester-rationale-generic"));
      expect(screen.queryByTestId("suggester-size-estimate")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("suggester-speedup-summary"));
      await waitFor(() => screen.getByTestId("hypopg-unavailable-noRepresentativeQuery"));
    });
  });

  // ── IPC call-once ─────────────────────────────────────────────────────────

  it("fires jsonbSuggesterHypotheticalExplain at most once per modal-open lifetime", async () => {
    mockJsonbSuggesterRun.mockResolvedValue(makeResult());
    mockJsonbSuggesterHypotheticalExplain.mockResolvedValue({
      kind: "computed",
      baselineCost: 1000,
      hypotheticalCost: 100,
      reductionPct: 90,
    });
    renderModal();
    await waitFor(() => screen.getByTestId("suggester-speedup-summary"));

    const summary = screen.getByTestId("suggester-speedup-summary");
    const details = screen.getByTestId("suggester-speedup-details");

    // First expand
    fireEvent.click(summary);
    await waitFor(() => screen.getByTestId("hypopg-computed"));
    expect(mockJsonbSuggesterHypotheticalExplain).toHaveBeenCalledTimes(1);

    // Collapse and re-expand should NOT fire again
    fireEvent.click(summary);
    fireEvent.click(summary);
    await waitFor(() => {
      // Give React a tick to process the toggle
      expect(details).toBeDefined();
    });
    expect(mockJsonbSuggesterHypotheticalExplain).toHaveBeenCalledTimes(1);
  });

  // ── Action buttons ────────────────────────────────────────────────────────

  it("[Copy SQL] calls navigator.clipboard.writeText with the recommended SQL", async () => {
    mockJsonbSuggesterRun.mockResolvedValue(makeResult());
    renderModal();
    await waitFor(() => screen.getByTestId("suggester-copy-btn"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("suggester-copy-btn"));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(BASE_SQL);
  });

  it("[Open in editor] calls openEditorTab and onClose", async () => {
    mockJsonbSuggesterRun.mockResolvedValue(makeResult());
    const onClose = vi.fn();
    render(<SuggesterModal open connId="c1" fqn={BASE_FQN} onClose={onClose} />);
    await waitFor(() => screen.getByTestId("suggester-open-in-editor-btn"));
    fireEvent.click(screen.getByTestId("suggester-open-in-editor-btn"));
    expect(mockOpenEditorTab).toHaveBeenCalledWith("c1", {
      prefillSql: BASE_SQL,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("[Close] calls onClose", async () => {
    mockJsonbSuggesterRun.mockResolvedValue(makeResult());
    const onClose = vi.fn();
    render(<SuggesterModal open connId="c1" fqn={BASE_FQN} onClose={onClose} />);
    await waitFor(() => screen.getByTestId("suggester-close-btn"));
    fireEvent.click(screen.getByTestId("suggester-close-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape key", async () => {
    mockJsonbSuggesterRun.mockResolvedValue(makeResult());
    const onClose = vi.fn();
    render(<SuggesterModal open connId="c1" fqn={BASE_FQN} onClose={onClose} />);
    await waitFor(() => screen.getByTestId("suggester-modal"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── axe ───────────────────────────────────────────────────────────────────

  it("has 0 axe violations when loaded", async () => {
    mockJsonbSuggesterRun.mockResolvedValue(makeResult());
    const { container } = renderModal();
    await waitFor(() => screen.getByTestId("suggester-recommended-sql"));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
