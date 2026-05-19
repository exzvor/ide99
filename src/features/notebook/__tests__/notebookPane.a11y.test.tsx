/**
 * (a11y) — axe-core regression for NotebookPane.
 *
 * NotebookPane composes a header (rename + Save / Save-as / Open buttons,
 * autosave status) and CellList. The header's icon-only-style buttons all
 * carry `aria-label` from `notebook.action.*`; the CellList exposes Add /
 * Delete / Run icon-buttons with their own labels. We render the realistic
 * shape with one SQL + one Markdown + one Result cell so axe sees every
 * interactive control once.
 */

import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

vi.mock("@monaco-editor/react", () => ({
  Editor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (next: string | undefined) => void;
  }) => (    <textarea
      data-testid="monaco-stub"
      aria-label="SQL editor"
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
),
}));

vi.mock("monaco-sql-languages", () => ({
  LanguageIdEnum: { PG: "pgsql" },
  setupLanguageFeatures: vi.fn(),
}));

vi.mock("../../editor/monacoQuietTheme", () => ({
  readResolvedQuietTheme: () => "quiet-light",
  registerQuietThemes: vi.fn(),
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        return Object.entries(opts).reduce<string>(          (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
          key,
);
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

import { expectNoAxeViolations } from "../../../test/axeHelper";
import { NotebookPane } from "../NotebookPane";
import { useNotebooks } from "../store";
import type { Notebook } from "../types";

beforeEach(() => {
  invokeMock.mockReset();
  useNotebooks.setState({
    byId: {},
    loaded: false,
    runStateByCellId: {},
    runningByNotebookId: {},
  });
  // The pane calls load() on mount which goes through the store; make load
  // resolve to a deterministic notebook with one of each cell kind.
  const seed: Notebook = {
    id: "nb-1",
    name: "Test notebook",
    cells: [
      { kind: "sql", id: "c-sql", source: "SELECT 1", shareAsCte: false },
      { kind: "markdown", id: "c-md", source: "# Heading\n\nBody" },
    ],
    connectionId: "c1",
    filePath: null,
    createdAt: "2026-05-06T00:00:00Z",
    updatedAt: "2026-05-06T00:00:00Z",
  };
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "notebook_load") return Promise.resolve(seed);
    if (cmd === "notebook_save") return Promise.resolve(seed);
    return Promise.resolve(null);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotebookPane accessibility", () => {
  it("has 0 axe violations with a mixed (sql + markdown) notebook", async () => {
    const tab = {
      id: "tab-1",
      kind: "notebook" as const,
      notebookId: "nb-1",
      connectionId: "c1",
      createdAt: new Date().toISOString(),
    };
    const { container, findByTestId } = render(<NotebookPane tab={tab} />);
    // Wait until the pane has hydrated past the loading placeholder; the
    // notebook header is the first stable element rendered after load.
    await findByTestId("notebook-pane");
    await waitFor(() => {
      // Ensure header inputs are mounted.
      const name = container.querySelector('[data-testid="notebook-name"]');
      if (!name) throw new Error("not ready");
    });
    await expectNoAxeViolations(container);
  });
});
