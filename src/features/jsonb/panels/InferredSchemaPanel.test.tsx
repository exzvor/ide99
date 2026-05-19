import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bypass i18next — return bare key (+ interpolated values) so assertions are
// deterministic without needing a full i18next instance in jsdom.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const values = Object.values(vars).map(String).join(" ");
      return `${key} ${values}`;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../inference", () => {
  const mockInvalidate = vi.fn();
  const mockUseInferredSchema = vi.fn();
  return {
    useInferredSchema: mockUseInferredSchema,
    useJsonbInference: Object.assign((selector: any) => selector({ invalidate: mockInvalidate }), {
      getState: () => ({ invalidate: mockInvalidate }),
      setState: vi.fn(),
    }),
    __mockInvalidate: mockInvalidate,
    __mockUseInferredSchema: mockUseInferredSchema,
  };
});

import * as inferenceMod from "../inference";

import { InferredSchemaPanel } from "./InferredSchemaPanel";

const FQN = { schema: "public", table: "events", column: "data" };

describe("InferredSchemaPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders skeleton + aria-live message when status=pending", () => {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({ status: "pending" });
    render(<InferredSchemaPanel connId="c1" fqn={FQN} variant="browser" />);
    expect(screen.getByText(/statusPending/i)).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
  });

  it("renders error message + Retry when status=error", () => {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({
      status: "error",
      message: "boom",
    });
    render(<InferredSchemaPanel connId="c1" fqn={FQN} variant="browser" />);
    expect(screen.getByText(/panel\.error.*boom/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retryAction/i })).toBeInTheDocument();
  });

  it("renders empty message when schema has zero nodes", () => {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({
      status: "ready",
      schema: { nodes: [], sampleCount: 100, generatedAt: 0 },
    });
    render(<InferredSchemaPanel connId="c1" fqn={FQN} variant="modal" />);
    expect(screen.getByText(/panel\.empty/i)).toBeInTheDocument();
  });

  it("renders tree rows with labels for ready schema", () => {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({
      status: "ready",
      schema: {
        nodes: [
          {
            path: [{ key: "userId" }],
            kind: { kind: "primitive", value: "string" },
            freq: 0.98,
            samples: ["abc"],
          },
          {
            path: [{ key: "event" }],
            kind: { kind: "primitive", value: "string" },
            freq: 0.95,
            samples: [],
          },
        ],
        sampleCount: 100,
        generatedAt: Date.now(),
      },
    });
    render(<InferredSchemaPanel connId="c1" fqn={FQN} variant="browser" />);
    expect(screen.getByText("userId")).toBeInTheDocument();
    expect(screen.getByText("event")).toBeInTheDocument();
  });

  it("header (with Re-infer) renders for both variants — fixed  review", () => {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({
      status: "ready",
      schema: {
        nodes: [
          {
            path: [{ key: "x" }],
            kind: { kind: "primitive", value: "string" },
            freq: 1,
            samples: [],
          },
        ],
        sampleCount: 100,
        generatedAt: Date.now(),
      },
    });
    const { rerender } = render(<InferredSchemaPanel connId="c1" fqn={FQN} variant="modal" />);
    expect(screen.getByRole("button", { name: /reinferAction/i })).toBeInTheDocument();

    rerender(<InferredSchemaPanel connId="c1" fqn={FQN} variant="browser" />);
    // fix: header / Re-infer button must be visible in browser
    // variant too so users can refresh from the schema browser inline.
    expect(screen.getByRole("button", { name: /reinferAction/i })).toBeInTheDocument();
  });

  it("Stale badge appears for status=stale", () => {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({
      status: "stale",
      schema: {
        nodes: [
          {
            path: [{ key: "x" }],
            kind: { kind: "primitive", value: "string" },
            freq: 1,
            samples: [],
          },
        ],
        sampleCount: 100,
        generatedAt: Date.now(),
      },
    });
    render(<InferredSchemaPanel connId="c1" fqn={FQN} variant="modal" />);
    expect(screen.getByText(/staleBadge/i)).toBeInTheDocument();
  });

  it("Re-infer button calls invalidate", async () => {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({
      status: "ready",
      schema: {
        nodes: [
          {
            path: [{ key: "x" }],
            kind: { kind: "primitive", value: "string" },
            freq: 1,
            samples: [],
          },
        ],
        sampleCount: 100,
        generatedAt: Date.now(),
      },
    });
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<InferredSchemaPanel connId="c1" fqn={FQN} variant="modal" />);
    const btn = screen.getByRole("button", { name: /reinferAction/i });
    await userEvent.click(btn);
    expect((inferenceMod as any).__mockInvalidate).toHaveBeenCalledWith("c1", FQN);
  });

  it("Retry button on error state calls invalidate", async () => {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({
      status: "error",
      message: "boom",
    });
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<InferredSchemaPanel connId="c1" fqn={FQN} variant="browser" />);
    const btn = screen.getByRole("button", { name: /retryAction/i });
    await userEvent.click(btn);
    expect((inferenceMod as any).__mockInvalidate).toHaveBeenCalledWith("c1", FQN);
  });
});

// ---------------------------------------------------------------------------
// S17 — picker-mode props
// ---------------------------------------------------------------------------

describe("S17 picker-mode props", () => {
  const mockFqn = { schema: "public", table: "events", column: "data" };

  function setReadyWithNode(key: string) {
    (inferenceMod as any).__mockUseInferredSchema.mockReturnValue({
      status: "ready",
      schema: {
        nodes: [
          {
            path: [{ key }],
            kind: { kind: "primitive", value: "string" },
            freq: 1,
            samples: ["x"],
          },
        ],
        sampleCount: 100,
        generatedAt: Date.now(),
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("regression — without onPathSelect, rows render as <li role='treeitem'>", () => {
    setReadyWithNode("name");
    render(<InferredSchemaPanel connId="c1" fqn={mockFqn} variant="browser" />);
    // No picker buttons — plain treeitem roles.
    const treeitems = document.querySelectorAll("[role='treeitem']");
    expect(treeitems.length).toBeGreaterThan(0);
    const pickerButtons = document.querySelectorAll("button[aria-pressed]");
    expect(pickerButtons.length).toBe(0);
  });

  it("with onPathSelect, rows render as <button aria-pressed>", () => {
    setReadyWithNode("name");
    render(      <InferredSchemaPanel connId="c1" fqn={mockFqn} variant="browser" onPathSelect={() => {}} />,
);
    const pickerButtons = document.querySelectorAll("button[aria-pressed]");
    expect(pickerButtons.length).toBeGreaterThan(0);
  });

  it("clicking a picker row invokes onPathSelect with the row's path", async () => {
    setReadyWithNode("name");
    const onPathSelect = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    render(      <InferredSchemaPanel
        connId="c1"
        fqn={mockFqn}
        variant="browser"
        onPathSelect={onPathSelect}
      />,
);
    const btn = document.querySelector("button[aria-pressed]") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await userEvent.click(btn);
    expect(onPathSelect).toHaveBeenCalledWith([{ key: "name" }]);
  });

  it("with selectedPath matching node.path, that row has aria-pressed=true", () => {
    setReadyWithNode("name");
    render(      <InferredSchemaPanel
        connId="c1"
        fqn={mockFqn}
        variant="browser"
        onPathSelect={() => {}}
        selectedPath={[{ key: "name" }]}
      />,
);
    const pressedButtons = document.querySelectorAll("button[aria-pressed='true']");
    expect(pressedButtons.length).toBe(1);
  });
});
