/**
 * — ErdPane dirty-state confirm modal flow.
 *
 * Acceptance behavior: when ops are pending, clicking Discard surfaces a
 * confirm modal so accidental loss requires an explicit second click.
 * Cancel preserves ops; Confirm clears them.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErdSchemaGraph } from "../../lib/tauri";
import type { ErdLoadState } from "./store";

const FAKE_DICT: Record<string, string> = {
  "erd.edit.toggle.label": "Edit mode",
  "erd.edit.new_table": "+ New table",
  "erd.edit.apply": "Apply",
  "erd.edit.discard": "Discard",
  "erd.edit.confirm.discard.title": "Discard schema edits?",
  "erd.edit.confirm.discard.body": "{{n}} unapplied changes",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const template = FAKE_DICT[key] ?? key;
      if (!vars) return template;
      return Object.entries(vars).reduce<string>((acc, [k, v]) => {
        return acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
      }, template);
    },
  }),
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    schemaApplyDdl: vi.fn(),
    erdSavePositions: vi.fn(async () => undefined),
    erdLoadPositions: vi.fn(async () => []),
  };
});

let mockState: ErdLoadState = { kind: "idle" };
const mockRetry = vi.fn();

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return {
    ...actual,
    useErdGraph: () => ({ state: mockState, retry: mockRetry }),
  };
});

vi.mock("./layout", async () => {
  const actual = await vi.importActual<typeof import("./layout")>("./layout");
  return {
    ...actual,
    layoutGraph: (graph: ErdSchemaGraph) => ({
      nodes: graph.tables.map((t, i) => ({
        id: `${t.schema}.${t.name}`,
        schema: t.schema,
        name: t.name,
        columns: t.columns,
        x: i * 250,
        y: 0,
        width: 240,
        height: 60,
      })),
      edges: [],
      width: graph.tables.length * 250,
      height: 100,
      layoutMs: 5,
    }),
  };
});

vi.mock("../editor/store", () => ({
  useEditor: { getState: () => ({ setErdTabSchemas: vi.fn() }) },
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

import { ErdPane } from "./ErdPane";
import { useEditStore } from "./edit/store";

const sampleGraph: ErdSchemaGraph = {
  tables: [
    {
      schema: "public",
      name: "users",
      columns: [
        {
          name: "id",
          dataType: "bigint",
          nullable: false,
          isPrimaryKey: true,
          isForeignKey: false,
          ordinal: 1,
        },
      ],
    },
  ],
  foreignKeys: [],
  fetchedInMs: 0,
};

beforeEach(() => {
  mockState = { kind: "ready", graph: sampleGraph };
  mockRetry.mockReset();
  useEditStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErdPane dirty-state confirm", () => {
  it("Discard with pending ops opens confirm modal; Cancel preserves ops", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));
    await user.click(screen.getByTestId("edit-new-table"));
    expect(useEditStore.getState().getOps("erd-c1")).toHaveLength(1);

    await user.click(screen.getByTestId("edit-discard"));
    expect(screen.getByTestId("discard-confirm-modal")).toBeInTheDocument();

    await user.click(screen.getByTestId("discard-confirm-cancel"));
    expect(screen.queryByTestId("discard-confirm-modal")).toBeNull();
    expect(useEditStore.getState().getOps("erd-c1")).toHaveLength(1);
  });

  it("Discard → Confirm clears ops", async () => {
    const user = userEvent.setup();
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    await user.click(screen.getByTestId("edit-toggle"));
    await user.click(screen.getByTestId("edit-new-table"));

    await user.click(screen.getByTestId("edit-discard"));
    await user.click(screen.getByTestId("discard-confirm-ok"));
    expect(screen.queryByTestId("discard-confirm-modal")).toBeNull();
    expect(useEditStore.getState().getOps("erd-c1")).toEqual([]);
  });

  it("Discard button is disabled when no ops", async () => {
    render(<ErdPane connId="c1" schemas={undefined} tabId="erd-c1" />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("edit-toggle"));
    expect(screen.getByTestId("edit-discard")).toBeDisabled();
  });
});
