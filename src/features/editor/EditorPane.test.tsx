import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { translation } = vi.hoisted(() => {
  const t = (key: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts === "object") {
      return Object.entries(opts).reduce<string>(        (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)),
        key,
);
    }
    return key;
  };
  return {
    translation: {
      t,
      i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => translation,
}));

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
    queryExecute: vi.fn(),
  };
});

vi.mock("./MonacoEditor", () => ({
  MonacoEditor: ({ tabId }: { tabId: string }) => <div data-testid="monaco-mock">{tabId}</div>,
}));

vi.mock("./ResultPanel", () => ({
  ResultPanel: ({ tabId }: { tabId: string }) => <div data-testid="result-panel-mock">{tabId}</div>,
}));

vi.mock("./RunToolbar", () => ({
  RunToolbar: ({ tabId }: { tabId: string }) => <div data-testid="run-toolbar-mock">{tabId}</div>,
}));

vi.mock("../schema/ObjectDetails", () => ({
  ObjectDetails: ({ node }: { node: string }) => (    <div data-testid="object-details-mock">{node}</div>
),
}));

vi.mock("../history/HistoryTab", () => ({
  HistoryTab: () => <div data-testid="history-tab-mock">history</div>,
}));

import { EditorPane } from "./EditorPane";
import { __testing, useEditor } from "./store";

beforeEach(() => {
  __testing.reset();
});

describe("EditorPane", () => {
  test("renders empty state when no active tab", () => {
    render(<EditorPane />);
    expect(screen.getByTestId("editor-empty")).toBeInTheDocument();
    expect(screen.getByText("editor.empty.title")).toBeInTheDocument();
  });

  test("editor tab → renders Monaco + RunToolbar + ResultPanel split", () => {
    let id = "";
    act(() => {
      id = useEditor.getState().openEditorTab("conn-1").id;
    });
    render(<EditorPane />);

    expect(screen.getByTestId("monaco-mock")).toHaveTextContent(id);
    expect(screen.getByTestId("run-toolbar-mock")).toHaveTextContent(id);
    expect(screen.getByTestId("result-panel-mock")).toHaveTextContent(id);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "editor-pane");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", `editor-tab-${id}`);
  });

  test("object tab → delegates to ObjectDetails", () => {
    act(() => {
      useEditor.getState().openObjectTab("table:public/users", "conn-1");
    });
    render(<EditorPane />);

    const obj = screen.getByTestId("object-details-mock");
    expect(obj).toHaveTextContent("table:public/users");
    // Editor split must NOT mount when object kind is active.
    expect(screen.queryByTestId("monaco-mock")).not.toBeInTheDocument();
  });

  test("history tab → renders the HistoryTab component", () => {
    let id = "";
    act(() => {
      id = useEditor.getState().openHistoryTab().id;
    });
    render(<EditorPane />);
    expect(screen.getByTestId("history-tab-mock")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", `editor-tab-${id}`);
    expect(screen.queryByTestId("monaco-mock")).not.toBeInTheDocument();
  });
});
