// — : smoke test for the Hybrid Search wizard.
// Mocks `useEditor` so we can assert that submitting the form opens a new
// editor tab whose prefilled SQL was built by `buildHybridSearchSql`.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const openEditorTab = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

// Stub VectorValueInput with a button that flips the value to a literal mode.
// The wizard needs to translate a `VectorValue` into a SQL pivot expression,
// so we exercise that translation by setting a literal here.
vi.mock("../VectorValueInput", () => {
  return {
    VectorValueInput: ({
      onChange,
    }: {
      onChange: (v: { mode: "literal"; literal: string }) => void;
    }) => (
      <button
        type="button"
        data-testid="mock-set-literal"
        onClick={() => onChange({ mode: "literal", literal: "[0.1,0.2]" })}
      >
        set literal
      </button>
    ),
  };
});

import { HybridSearchWizard } from "../HybridSearchWizard";

describe("HybridSearchWizard", () => {
  it("builds the SQL with selected weights + literal pivot and opens an editor tab", async () => {
    const onClose = vi.fn();
    openEditorTab.mockClear();

    render(
      <HybridSearchWizard
        open={true}
        connId="conn-1"
        qualifiedTable="public.items"
        pk="id"
        vectorColumns={["embedding"]}
        textColumns={["title_ts"]}
        onClose={onClose}
      />,
    );

    // Trigger the literal-mode pivot via the mocked VectorValueInput.
    await userEvent.click(screen.getByTestId("mock-set-literal"));

    // Provide a tsQuery so the form submit path has all required inputs.
    const tsInput = screen.getByTestId("hybrid-ts-query") as HTMLInputElement;
    await userEvent.type(tsInput, "hello");

    // Override default weights to non-default values to verify they propagate.
    const wVec = screen.getByTestId("hybrid-w-vector") as HTMLInputElement;
    await userEvent.clear(wVec);
    await userEvent.type(wVec, "0.7");
    const wTxt = screen.getByTestId("hybrid-w-text") as HTMLInputElement;
    await userEvent.clear(wTxt);
    await userEvent.type(wTxt, "0.3");

    await userEvent.click(screen.getByTestId("hybrid-submit"));

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [connArg, opts] = openEditorTab.mock.calls[0];
    expect(connArg).toBe("conn-1");
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("-- pgvector hybrid search (RRF)");
    expect(sql).toContain("0.7");
    expect(sql).toContain("0.3");
    expect(sql).toContain("'[0.1,0.2]'::vector");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns null when closed", () => {
    const onClose = vi.fn();
    render(
      <HybridSearchWizard
        open={false}
        connId="conn-1"
        qualifiedTable="public.items"
        pk="id"
        vectorColumns={["embedding"]}
        textColumns={["title_ts"]}
        onClose={onClose}
      />,
    );
    expect(screen.queryByTestId("hybrid-search-wizard")).not.toBeInTheDocument();
  });
});
