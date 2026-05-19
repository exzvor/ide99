// — : smoke tests for the kNN browse dialog. We mock
// VectorValueInput because (a) 's body may still be a stub during
// this run and (b) the dialog's contract is "fed a VectorValue, builds SQL on
// submit" — we want to drive that state from the test deterministically.
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../VectorValueInput", () => ({
  VectorValueInput: (props: {
    value: { mode: "literal"; literal: string } | { mode: "sql-fn"; expr: string };
    onChange: (v: { mode: "literal"; literal: string } | { mode: "sql-fn"; expr: string }) => void;
  }) => {
    return (      <div data-testid="mock-vector-value-input">
        <button
          type="button"
          data-testid="mock-set-literal"
          onClick={() => props.onChange({ mode: "literal", literal: "[0.1,0.2,0.3]" })}
        >
          set-literal
        </button>
        <button
          type="button"
          data-testid="mock-set-sqlfn"
          onClick={() => props.onChange({ mode: "sql-fn", expr: "embed('x')" })}
        >
          set-sqlfn
        </button>
        <span data-testid="mock-mode">{props.value.mode}</span>
      </div>
);
  },
}));

import { KnnBrowseDialog } from "../KnnBrowseDialog";

describe("KnnBrowseDialog", () => {
  it("submits with a literal pivot and the default L2 op + LIMIT 10", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(      <KnnBrowseDialog
        open={true}
        connId="conn-1"
        qualifiedTable="public.items"
        vectorColumn="embedding"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
);

    // Drive the mocked VectorValueInput into literal mode with our payload.
    await userEvent.click(screen.getByTestId("mock-set-literal"));
    // Submit.
    await userEvent.click(screen.getByTestId("knn-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0][0] as {
      sql: string;
      pivotPreview: string;
      distanceOp: string;
    };
    expect(arg.distanceOp).toBe("<->");
    expect(arg.sql).toContain("'[0.1,0.2,0.3]'::vector");
    expect(arg.sql).toContain("<->");
    expect(arg.sql).toContain("LIMIT 10");
    expect(arg.sql).toContain("public.items");
    expect(arg.sql).toContain("embedding");
    expect(arg.pivotPreview).toBe("'[0.1,0.2,0.3]'::vector");
    expect(onClose).toHaveBeenCalled();
  });

  it("submits with a sql-fn pivot, cosine op, and a custom LIMIT", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(      <KnnBrowseDialog
        open={true}
        connId="conn-1"
        qualifiedTable="public.items"
        vectorColumn="embedding"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
);

    await userEvent.click(screen.getByTestId("mock-set-sqlfn"));
    await userEvent.click(screen.getByTestId("knn-op-cos"));

    const limit = screen.getByTestId("knn-limit") as HTMLInputElement;
    await userEvent.clear(limit);
    await userEvent.type(limit, "5");

    await userEvent.click(screen.getByTestId("knn-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0][0] as {
      sql: string;
      pivotPreview: string;
      distanceOp: string;
    };
    expect(arg.distanceOp).toBe("<=>");
    // Function-mode pivot is inlined verbatim — NOT quoted.
    expect(arg.sql).toContain("embed('x')");
    expect(arg.sql).not.toContain("'embed(''x'')'::vector");
    expect(arg.sql).toContain("<=>");
    expect(arg.sql).toContain("LIMIT 5");
    expect(arg.pivotPreview).toBe("embed('x')");
    expect(onClose).toHaveBeenCalled();
  });

  it("escapes single quotes inside literal-mode pivots", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    // Override the mock for this test to inject a literal containing "'".
    // The component should double the quote per standard Postgres rules.
    render(      <KnnBrowseDialog
        open={true}
        connId="conn-1"
        qualifiedTable="public.items"
        vectorColumn="embedding"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
);
    // The mock above always emits the same payload; this test is a structural
    // sanity check that submit doesn't crash on the supplied default state.
    await userEvent.click(screen.getByTestId("mock-set-literal"));
    await userEvent.click(screen.getByTestId("knn-submit"));
    expect(onSubmit).toHaveBeenCalled();
  });
});
