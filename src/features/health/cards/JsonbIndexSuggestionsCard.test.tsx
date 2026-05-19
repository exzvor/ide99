/**
 * — JsonbIndexSuggestionsCard comprehensive tests.
 *
 * Covers:
 * - All CardState variants: loading, ready (with rows), empty, unavailable, error.
 * - [View] opens SuggesterModal with the correct suggestion data.
 * - Auto-refresh does not close an open modal (modal state lives within card).
 */

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import type { SuggesterResult } from "../../../lib/tauri";
import type { CardState, JsonbIndexSuggestionsData } from "../../health/store";
import { JsonbIndexSuggestionsCard } from "./JsonbIndexSuggestionsCard";

// ─── i18n ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockJsonbSuggesterRun = vi.fn<() => Promise<SuggesterResult>>();

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    jsonbSuggesterRun: (...args: unknown[]) => mockJsonbSuggesterRun(...(args as [])),
    jsonbSuggesterHypotheticalExplain: vi.fn().mockReturnValue(new Promise(() => {})),
  };
});

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab: vi.fn() }),
  },
}));

vi.mock("../store", async () => {
  const actual = await vi.importActual<typeof import("../store")>("../store");
  return {
    ...actual,
    useHealth: {
      getState: () => ({
        refreshOne: vi.fn(),
      }),
    },
  };
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReadyState(rows: JsonbIndexSuggestionsData["rows"] = []): CardState {
  const data: JsonbIndexSuggestionsData = {
    rows,
    pgStatStatementsUnavailable: false,
    pgStatStatementsInstallSql: "",
  };
  return {
    status: "ready",
    card: { id: "jsonb_index_suggestions", data },
  };
}

const SAMPLE_ROWS: JsonbIndexSuggestionsData["rows"] = [
  {
    schema: "public",
    table: "events",
    column: "data",
    op: "@>",
    calls: 1243,
    totalExecTimeMs: 8400,
    recommendedSql:
      "CREATE INDEX CONCURRENTLY idx_events_data_gin ON public.events USING GIN (data jsonb_path_ops);",
    indexName: "idx_events_data_gin",
  },
  {
    schema: "public",
    table: "users",
    column: "profile",
    op: "->>",
    calls: 412,
    totalExecTimeMs: 1200,
    recommendedSql:
      "CREATE INDEX CONCURRENTLY idx_users_profile_gin ON public.users USING GIN ((profile->>'email'));",
    indexName: "idx_users_profile_gin",
  },
  {
    schema: "public",
    table: "products",
    column: "attrs",
    op: "?",
    calls: 87,
    totalExecTimeMs: 240,
    recommendedSql:
      "CREATE INDEX CONCURRENTLY idx_products_attrs_gin ON public.products USING GIN (attrs jsonb_ops);",
    indexName: "idx_products_attrs_gin",
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("JsonbIndexSuggestionsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJsonbSuggesterRun.mockReturnValue(new Promise(() => {}));
  });

  it("renders card title", () => {
    render(<JsonbIndexSuggestionsCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByText(/JSONB index suggestions/i)).toBeInTheDocument();
  });

  describe("loading state", () => {
    it("renders skeleton shimmer", () => {
      render(<JsonbIndexSuggestionsCard connId="c1" state={{ status: "loading" }} />);
      expect(        screen.getByTestId("health-card-jsonb_index_suggestions-skeleton"),
).toBeInTheDocument();
    });
  });

  describe("ready state with rows", () => {
    it("renders top-3 rows", () => {
      render(<JsonbIndexSuggestionsCard connId="c1" state={makeReadyState(SAMPLE_ROWS)} />);
      const rows = screen.getAllByTestId("jsonb-suggestion-row");
      expect(rows).toHaveLength(3);
    });

    it("renders View button for each row", () => {
      render(<JsonbIndexSuggestionsCard connId="c1" state={makeReadyState(SAMPLE_ROWS)} />);
      const viewBtns = screen.getAllByTestId("jsonb-row-view-btn");
      expect(viewBtns).toHaveLength(3);
    });

    it("caps at top-3 even with more rows", () => {
      const manyRows = [...SAMPLE_ROWS, ...SAMPLE_ROWS]; // 6 rows
      render(<JsonbIndexSuggestionsCard connId="c1" state={makeReadyState(manyRows)} />);
      expect(screen.getAllByTestId("jsonb-suggestion-row")).toHaveLength(3);
    });

    it("[View] click opens SuggesterModal with correct fqn", async () => {
      mockJsonbSuggesterRun.mockReturnValue(new Promise(() => {}));
      render(<JsonbIndexSuggestionsCard connId="c1" state={makeReadyState(SAMPLE_ROWS)} />);
      const viewBtns = screen.getAllByTestId("jsonb-row-view-btn");
      fireEvent.click(viewBtns[1]); // users.profile
      await waitFor(() => expect(screen.getByTestId("suggester-modal")).toBeInTheDocument());
      // Check that it called jsonbSuggesterRun with the right column scope
      expect(mockJsonbSuggesterRun).toHaveBeenCalledWith(        "c1",
        expect.objectContaining({
          kind: "column",
          schema: "public",
          table: "users",
          column: "profile",
        }),
);
    });

    it("auto-refresh (re-render with new state) keeps modal open", async () => {
      mockJsonbSuggesterRun.mockReturnValue(new Promise(() => {}));
      const { rerender } = render(        <JsonbIndexSuggestionsCard connId="c1" state={makeReadyState(SAMPLE_ROWS)} />,
);
      const viewBtns = screen.getAllByTestId("jsonb-row-view-btn");
      fireEvent.click(viewBtns[0]);
      await waitFor(() => expect(screen.getByTestId("suggester-modal")).toBeInTheDocument());

      // Simulate auto-refresh: card gets a new ready state with updated rows
      act(() => {
        rerender(<JsonbIndexSuggestionsCard connId="c1" state={makeReadyState(SAMPLE_ROWS)} />);
      });

      // Modal should still be open (viewFqn state lives inside the card)
      expect(screen.getByTestId("suggester-modal")).toBeInTheDocument();
    });
  });

  describe("empty state (rows=[], pg_stat_statements available)", () => {
    it("renders CardShell empty state", () => {
      render(        <JsonbIndexSuggestionsCard connId="c1" state={{ status: "empty", reason: "no_data" }} />,
);
      expect(screen.getByTestId("health-card-jsonb_index_suggestions-empty")).toBeInTheDocument();
    });
  });

  describe("unavailable state (pg_stat_statements missing)", () => {
    it("renders unavailable block with install SQL", () => {
      render(        <JsonbIndexSuggestionsCard
          connId="c1"
          state={{
            status: "unavailable",
            extension: "pg_stat_statements",
            installSql: "CREATE EXTENSION pg_stat_statements;",
          }}
        />,
);
      expect(        screen.getByTestId("health-card-jsonb_index_suggestions-unavailable"),
).toBeInTheDocument();
      const unavailBlock = screen.getByTestId("health-card-jsonb_index_suggestions-unavailable");
      expect(unavailBlock.textContent).toContain("pg_stat_statements");
    });
  });

  describe("error state", () => {
    it("renders error block with retry button", () => {
      render(        <JsonbIndexSuggestionsCard
          connId="c1"
          state={{ status: "error", message: "connection refused" }}
        />,
);
      expect(screen.getByTestId("health-card-jsonb_index_suggestions-error")).toBeInTheDocument();
      expect(screen.getByTestId("health-card-jsonb_index_suggestions-retry")).toBeInTheDocument();
    });
  });

  describe("ready state with zero rows (pg_stat_statements available but no ops)", () => {
    it("shows empty-body message", () => {
      render(<JsonbIndexSuggestionsCard connId="c1" state={makeReadyState([])} />);
      // body shows the empty message
      expect(screen.getByTestId("jsonb-suggestions-empty-body")).toBeInTheDocument();
      expect(screen.getByText(/No JSONB ops detected in pg_stat_statements/i)).toBeInTheDocument();
    });
  });
});
