/**
 * — OperatorForm component tests.
 *
 * Tests each operator form variant and type-aware coercion.
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorForm } from "./OperatorForm";
import type { BuilderFormState } from "./state";
import { initialState } from "./state";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return `${key}(${Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")})`;
    },
  }),
}));

vi.mock("../inference", () => ({
  useInferredSchema: vi.fn().mockReturnValue({ status: "pending" }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fqn = { schema: "public", table: "events", column: "data" };

function renderForm(overrides?: Partial<BuilderFormState>) {
  const state: BuilderFormState = { ...initialState(), ...overrides };
  const dispatch = vi.fn();
  const { rerender, ...rest } = render(
    <OperatorForm connId="c1" fqn={fqn} state={state} dispatch={dispatch} />,
  );
  return { state, dispatch, rerender, ...rest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator dropdown
// ─────────────────────────────────────────────────────────────────────────────

describe("OperatorForm — operator dropdown", () => {
  it("renders operator select with 4 options", () => {
    renderForm();
    const select = screen.getByRole("combobox", { name: /jsonb\.builder\.operatorLabel/i });
    expect(select).toBeInTheDocument();
    // combobox has 4 operator options
    const options = screen.getAllByRole("option");
    const opOptions = options.filter((o) => (o as HTMLOptionElement).parentElement === select);
    expect(opOptions).toHaveLength(4);
  });

  it("dispatches SET_OP when operator changes", () => {
    const { dispatch } = renderForm();
    const select = screen.getByRole("combobox", { name: /jsonb\.builder\.operatorLabel/i });
    fireEvent.change(select, { target: { value: "containment" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_OP", opKind: "containment" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Existence form
// ─────────────────────────────────────────────────────────────────────────────

describe("OperatorForm — existence", () => {
  it("renders text input for key", () => {
    renderForm({ opKind: "existence" });
    expect(screen.getByLabelText(/jsonb\.builder\.valueLabel/i)).toBeInTheDocument();
  });

  it("does NOT show warning when path is empty", () => {
    renderForm({ opKind: "existence", selectedPath: [] });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("does NOT show duplicate warning in ExistenceForm (warning rendered by modal from preview.warnings)", () => {
    // fix: warning is rendered once by JsonbQueryBuilderModal from
    // preview.warnings, NOT inside ExistenceForm, to prevent duplication.
    renderForm({ opKind: "existence", selectedPath: [{ key: "user" }] });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("dispatches SET_VALUE on key input", () => {
    const { dispatch } = renderForm({ opKind: "existence" });
    const input = screen.getByLabelText(/jsonb\.builder\.valueLabel/i);
    fireEvent.change(input, { target: { value: "mykey" } });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_VALUE",
      value: { kind: "string", value: "mykey" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Containment — type-aware
// ─────────────────────────────────────────────────────────────────────────────

describe("OperatorForm — containment type-aware", () => {
  it("renders text input for unknown leaf type", () => {
    renderForm({ opKind: "containment" });
    // Default is JSON textarea for unknown/null leaf
    // textarea should be rendered
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders bool select when leaf is boolean", async () => {
    const { useInferredSchema } = await import("../inference");
    vi.mocked(useInferredSchema).mockReturnValue({
      status: "ready",
      schema: {
        nodes: [
          {
            path: [{ key: "active" }],
            kind: { kind: "primitive", value: "boolean" },
            freq: 1,
            samples: [],
          },
        ],
        sampleCount: 10,
        generatedAt: Date.now(),
      },
    });
    renderForm({
      opKind: "containment",
      selectedPath: [{ key: "active" }],
    });
    // There should be a select with true/false options
    const selects = screen.getAllByRole("combobox");
    // The second select should be the bool value select (first is operator)
    const valueSelect = selects.find((s) => {
      const opts = Array.from(s.querySelectorAll("option")).map((o) => o.value);
      return opts.includes("true") && opts.includes("false");
    });
    expect(valueSelect).toBeDefined();
    vi.mocked(useInferredSchema).mockReturnValue({ status: "pending" });
  });

  it("renders enum dropdown when leaf is Enum", async () => {
    const { useInferredSchema } = await import("../inference");
    vi.mocked(useInferredSchema).mockReturnValue({
      status: "ready",
      schema: {
        nodes: [
          {
            path: [{ key: "status" }],
            kind: { kind: "enum", values: ["active", "inactive", "pending"] },
            freq: 1,
            samples: [],
          },
        ],
        sampleCount: 10,
        generatedAt: Date.now(),
      },
    });
    renderForm({
      opKind: "containment",
      selectedPath: [{ key: "status" }],
    });
    // The enum dropdown should have the enum values as options
    const selects = screen.getAllByRole("combobox");
    const enumSelect = selects.find((s) => {
      const opts = Array.from(s.querySelectorAll("option")).map((o) => o.value);
      return opts.includes("active") && opts.includes("inactive");
    });
    expect(enumSelect).toBeDefined();
    vi.mocked(useInferredSchema).mockReturnValue({ status: "pending" });
  });

  it("renders number input when leaf is number", async () => {
    const { useInferredSchema } = await import("../inference");
    vi.mocked(useInferredSchema).mockReturnValue({
      status: "ready",
      schema: {
        nodes: [
          {
            path: [{ key: "score" }],
            kind: { kind: "primitive", value: "number" },
            freq: 1,
            samples: [],
          },
        ],
        sampleCount: 10,
        generatedAt: Date.now(),
      },
    });
    renderForm({
      opKind: "containment",
      selectedPath: [{ key: "score" }],
    });
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    // Only digits should be accepted — non-numeric input should not dispatch
    vi.mocked(useInferredSchema).mockReturnValue({ status: "pending" });
  });

  it("rejects non-numeric chars for number leaf", async () => {
    const { useInferredSchema } = await import("../inference");
    vi.mocked(useInferredSchema).mockReturnValue({
      status: "ready",
      schema: {
        nodes: [
          {
            path: [{ key: "score" }],
            kind: { kind: "primitive", value: "number" },
            freq: 1,
            samples: [],
          },
        ],
        sampleCount: 10,
        generatedAt: Date.now(),
      },
    });
    const { dispatch } = renderForm({
      opKind: "containment",
      selectedPath: [{ key: "score" }],
    });
    const input = screen.getByRole("textbox");
    // Typing "abc" should not dispatch
    fireEvent.change(input, { target: { value: "abc" } });
    // dispatch should not have been called (non-numeric rejected)
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ value: { kind: "number", value: "abc" } }),
    );
    // Valid number
    fireEvent.change(input, { target: { value: "42" } });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_VALUE",
      value: { kind: "number", value: "42" },
    });
    vi.mocked(useInferredSchema).mockReturnValue({ status: "pending" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PathExtract form
// ─────────────────────────────────────────────────────────────────────────────

describe("OperatorForm — pathExtract", () => {
  it("renders projection radio + comparison radio", () => {
    renderForm({ opKind: "pathExtract" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    // Projection is selected by default
    const projRadio = radios.find((r) => (r as HTMLInputElement).value === "projection");
    expect(projRadio).not.toBeNull();
    expect((projRadio as HTMLInputElement).checked).toBe(true);
  });

  it("switching to comparison mode dispatches SET_EXTRACT_MODE", () => {
    const { dispatch } = renderForm({ opKind: "pathExtract" });
    const radios = screen.getAllByRole("radio");
    const compRadio = radios.find((r) => (r as HTMLInputElement).value === "comparison");
    if (compRadio) fireEvent.click(compRadio);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_EXTRACT_MODE",
      mode: "comparison",
    });
  });

  it("shows value input in comparison mode", () => {
    renderForm({
      opKind: "pathExtract",
      extractMode: { kind: "comparison", eqValue: { kind: "none" } },
    });
    // Should have a textbox for the comparison value
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("does NOT show value input in projection mode", () => {
    renderForm({
      opKind: "pathExtract",
      extractMode: { kind: "projection" },
    });
    // No textbox in projection mode
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PathPredicate form
// ─────────────────────────────────────────────────────────────────────────────

describe("OperatorForm — pathPredicate", () => {
  it("renders comparator select + value input", () => {
    renderForm({ opKind: "pathPredicate" });
    const selects = screen.getAllByRole("combobox");
    // Should have: operator selector + comparator selector
    expect(selects.length).toBeGreaterThanOrEqual(2);
    // Value input should be present
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("dispatches SET_PREDICATE_COMPARATOR when comparator changes", () => {
    const { dispatch } = renderForm({ opKind: "pathPredicate" });
    // The comparator select is the second combobox (first is operator)
    const selects = screen.getAllByRole("combobox");
    // Find the comparator select (has == option)
    const cmpSelect = selects.find((s) => {
      const opts = Array.from(s.querySelectorAll("option")).map((o) => o.value);
      return opts.includes("eq") || opts.includes("ne");
    });
    if (cmpSelect) fireEvent.change(cmpSelect, { target: { value: "ne" } });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PREDICATE_COMPARATOR",
      comparator: "ne",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path display
// ─────────────────────────────────────────────────────────────────────────────

describe("OperatorForm — path display", () => {
  it("shows placeholder when path is empty", () => {
    renderForm({ selectedPath: [] });
    expect(screen.getByText(/jsonb\.builder\.pathPlaceholder/)).toBeInTheDocument();
  });

  it("shows path segments when path is set", () => {
    renderForm({ selectedPath: [{ key: "user" }, { key: "email" }] });
    // Should show "user → email"
    expect(screen.getByText(/user.*email/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON textarea lint
// ─────────────────────────────────────────────────────────────────────────────

describe("OperatorForm — JSON textarea lint", () => {
  beforeEach(async () => {
    // Reset useInferredSchema to pending (null leaf)
    const { useInferredSchema } = await import("../inference");
    vi.mocked(useInferredSchema).mockReturnValue({ status: "pending" });
  });

  it("shows no error for empty textarea", () => {
    renderForm({
      opKind: "containment",
      value: { kind: "none" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows error for invalid JSON input", () => {
    renderForm({
      opKind: "containment",
      value: { kind: "jsonLiteral", value: "not json" },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/jsonb\.builder\.error\.invalidJson/);
  });

  it("shows no error for valid JSON input", () => {
    renderForm({
      opKind: "containment",
      value: { kind: "jsonLiteral", value: '{"key": 1}' },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
