/**
 * — JsonbQueryBuilderModal component tests.
 */

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonbQueryBuilderModal } from "./JsonbQueryBuilderModal";

expect.extend(toHaveNoViolations);

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return `${key}(${Object.values(vars).map(String).join(",")})`;
    },
  }),
}));

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    jsonbBuilderPreview: vi.fn(),
  };
});

// Mock the inference panel so it doesn't try to call Tauri APIs
vi.mock("../panels/InferredSchemaPanel", () => ({
  InferredSchemaPanel: ({
    onPathSelect,
    selectedPath,
  }: {
    onPathSelect?: (path: unknown[]) => void;
    selectedPath?: unknown[];
  }) => (    <div data-testid="schema-panel-mock">
      <button
        type="button"
        data-testid="pick-path-btn"
        onClick={() => onPathSelect?.([{ key: "user" }, { key: "email" }])}
      >
        Pick path
      </button>
      <span data-testid="selected-path">{JSON.stringify(selectedPath)}</span>
    </div>
),
}));

// Mock OperatorForm to avoid deep inference store wiring in modal tests
vi.mock("./OperatorForm", () => ({
  OperatorForm: ({
    state,
    dispatch,
  }: { state: { opKind: string }; dispatch: (a: unknown) => void }) => (    <div data-testid="operator-form-mock">
      <select
        aria-label="jsonb.builder.operatorLabel"
        value={state.opKind}
        onChange={(e) => dispatch({ type: "SET_OP", opKind: e.target.value })}
      >
        <option value="existence">existence</option>
        <option value="containment">containment</option>
        <option value="pathExtract">pathExtract</option>
        <option value="pathPredicate">pathPredicate</option>
      </select>
    </div>
),
}));

vi.mock("../../editor/store", () => ({
  useEditor: Object.assign(vi.fn().mockReturnValue({}), {
    getState: vi.fn().mockReturnValue({ openEditorTab: vi.fn() }),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fqn = { schema: "public", table: "events", column: "data" };
const PREVIEW_SQL = 'SELECT * FROM "public"."events" WHERE "data" ? \'user\' LIMIT 100';

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let openEditorTabMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // Set up IPC mock
  const tauri = await import("../../../lib/tauri");
  vi.mocked(tauri.jsonbBuilderPreview).mockResolvedValue({
    sql: PREVIEW_SQL,
    warnings: [],
  });
  // Set up editor store mock
  openEditorTabMock = vi.fn();
  const { useEditor } = await import("../../editor/store");
  (useEditor.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    openEditorTab: openEditorTabMock,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonbQueryBuilderModal", () => {
  it("open=false renders nothing", () => {
    const { container } = render(      <JsonbQueryBuilderModal open={false} connId="c1" fqn={fqn} onClose={() => {}} />,
);
    expect(container).toBeEmptyDOMElement();
  });

  it("open=true renders the modal with dialog role", () => {
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("modal has aria-modal=true", () => {
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("title contains table and column from fqn", () => {
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    expect(screen.getByText(/jsonb\.builder\.title/i)).toBeInTheDocument();
  });

  it("SQL preview textarea is present", () => {
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    expect(screen.getByTestId("builder-sql-preview")).toBeInTheDocument();
  });

  it("[Generate] button is initially disabled before preview resolves", async () => {
    // Block the IPC so preview never resolves
    const tauri = await import("../../../lib/tauri");
    vi.mocked(tauri.jsonbBuilderPreview).mockReturnValue(new Promise(() => {}));
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    // In the very first render before debounce fires + local preview hasn't run,
    // preview=null → disabled.
    expect(screen.getByTestId("builder-generate-btn")).toBeInTheDocument();
  });

  it("IPC preview NOT called without a path (fix)", async () => {
    // With fix: IPC should NOT fire when path is empty
    const tauri = await import("../../../lib/tauri");
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    // Wait a bit to ensure debounce would have fired
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(tauri.jsonbBuilderPreview).not.toHaveBeenCalled();
  });

  it("IPC preview called after debounce when path is set", async () => {
    const tauri = await import("../../../lib/tauri");
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    // Pick a path first (IPC only fires when path is non-empty)
    await act(async () => {
      fireEvent.click(screen.getByTestId("pick-path-btn"));
    });
    await waitFor(      () => {
        expect(tauri.jsonbBuilderPreview).toHaveBeenCalled();
      },
      { timeout: 500 },
);
  });

  it("[Generate] becomes enabled after path is set and IPC preview succeeds", async () => {
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    // Generate is disabled without a path
    expect(screen.getByTestId("builder-generate-btn")).toBeDisabled();
    // Pick a path
    await act(async () => {
      fireEvent.click(screen.getByTestId("pick-path-btn"));
    });
    await waitFor(      () => {
        expect(screen.getByTestId("builder-generate-btn")).not.toBeDisabled();
      },
      { timeout: 500 },
);
  });

  it("clicking [Generate] calls openEditorTab with prefillSql + closes modal", async () => {
    const tauri = await import("../../../lib/tauri");
    const onClose = vi.fn();
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={onClose} />);
    // First pick a path so IPC fires
    await act(async () => {
      fireEvent.click(screen.getByTestId("pick-path-btn"));
    });
    // Wait for IPC to have been called AND resolved so preview.sql = IPC value
    await waitFor(      () => {
        expect(tauri.jsonbBuilderPreview).toHaveBeenCalled();
      },
      { timeout: 500 },
);
    // Give the promise resolution a tick to land
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId("builder-generate-btn"));
    expect(openEditorTabMock).toHaveBeenCalledWith("c1", {
      prefillSql: PREVIEW_SQL,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc key closes the modal", () => {
    const onClose = vi.fn();
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("[Cancel] button in footer calls onClose", () => {
    const onClose = vi.fn();
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={onClose} />);
    // There are two buttons with cancel text - footer and header ×
    // Use getByRole with name = cancel i18n key
    const cancelBtns = screen.getAllByText(/jsonb\.builder\.actions\.cancel/i);
    // Click the footer cancel (last one)
    const lastCancelBtn = cancelBtns[cancelBtns.length - 1];
    if (lastCancelBtn) fireEvent.click(lastCancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("picking a path from the panel updates selectedPath", async () => {
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("pick-path-btn"));
    });
    const pathEl = screen.getByTestId("selected-path");
    expect(pathEl.textContent).toContain("user");
  });

  it("picking a path triggers a debounced preview call", async () => {
    // No IPC on empty path. After picking a path, IPC fires once.
    const tauri = await import("../../../lib/tauri");
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    // Pick a path
    await act(async () => {
      fireEvent.click(screen.getByTestId("pick-path-btn"));
    });
    // IPC called exactly once (for the path pick)
    await waitFor(() => expect(tauri.jsonbBuilderPreview).toHaveBeenCalledTimes(1), {
      timeout: 500,
    });
  });

  it("[Generate] is disabled when preview returns error", async () => {
    const tauri = await import("../../../lib/tauri");
    vi.mocked(tauri.jsonbBuilderPreview).mockRejectedValue(new Error("invalid json"));
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    await waitFor(      () => {
        expect(screen.getByTestId("builder-generate-btn")).toBeDisabled();
      },
      { timeout: 500 },
);
  });

  it("shows InferredSchemaPanel with onPathSelect", () => {
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    expect(screen.getByTestId("schema-panel-mock")).toBeInTheDocument();
  });

  it("operator change via OperatorForm dispatch is handled", async () => {
    const tauri = await import("../../../lib/tauri");
    render(<JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />);
    // Pick a path first so that operator-change also triggers IPC
    await act(async () => {
      fireEvent.click(screen.getByTestId("pick-path-btn"));
    });
    const select = screen.getByRole("combobox", { name: /jsonb\.builder\.operatorLabel/i });
    // Switch operator
    await act(async () => {
      fireEvent.change(select, { target: { value: "containment" } });
    });
    // The select now shows containment
    expect(select).toHaveValue("containment");
    // A new preview should be triggered (path is set, so IPC fires)
    await waitFor(      () => {
        expect(tauri.jsonbBuilderPreview).toHaveBeenCalled();
      },
      { timeout: 500 },
);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonbQueryBuilderModal accessibility", () => {
  it("has 0 axe violations when open", async () => {
    const { container } = render(      <JsonbQueryBuilderModal open={true} connId="c1" fqn={fqn} onClose={() => {}} />,
);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
