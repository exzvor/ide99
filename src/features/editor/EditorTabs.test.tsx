import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("../schema/store", () => {
  const stateSnapshot = {
    connection: { status: "connected", connId: "conn-1" } as const,
  };
  const useSchema = (() => stateSnapshot) as unknown as {
    getState: () => typeof stateSnapshot;
  };
  useSchema.getState = () => stateSnapshot;
  return { useSchema };
});

import { EditorTabs } from "./EditorTabs";
import { __testing, useEditor } from "./store";

beforeEach(() => {
  __testing.reset();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("EditorTabs", () => {
  test("renders tablist with the correct aria roles", () => {
    act(() => {
      useEditor.getState().openEditorTab("conn-1");
    });
    render(<EditorTabs />);

    const list = screen.getByRole("tablist");
    expect(list).toBeInTheDocument();
    const tab = screen.getByRole("tab");
    expect(tab).toHaveAttribute("aria-controls", "editor-pane");
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  test("clicking a tab switches activation", async () => {
    let aId = "";
    let bId = "";
    act(() => {
      aId = useEditor.getState().openEditorTab(null).id;
      bId = useEditor.getState().openEditorTab(null).id;
    });
    expect(useEditor.getState().activeTabId).toBe(bId);

    render(<EditorTabs />);
    const tabA = screen.getByRole("tab", { name: /untitled-1/ });
    await userEvent.click(tabA);

    expect(useEditor.getState().activeTabId).toBe(aId);
  });

  test('"+" button opens a new editor tab pinned to active connection', async () => {
    render(<EditorTabs />);
    const newBtn = screen.getByRole("button", { name: "editor.tabs.new" });
    await userEvent.click(newBtn);

    const state = useEditor.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].kind).toBe("editor");
    if (state.tabs[0].kind === "editor") {
      expect(state.tabs[0].connectionId).toBe("conn-1");
    }
  });

  test("close × on a clean editor tab → immediate close", async () => {
    let id = "";
    act(() => {
      id = useEditor.getState().openEditorTab(null).id;
    });
    render(<EditorTabs />);

    const closeBtn = screen.getByRole("button", {
      name: /editor.tabs.close/,
    });
    await userEvent.click(closeBtn);

    expect(useEditor.getState().tabs.find((t) => t.id === id)).toBeUndefined();
  });

  test("close × on a dirty editor tab opens confirm modal; Cancel → no close", async () => {
    let id = "";
    act(() => {
      id = useEditor.getState().openEditorTab(null).id;
      useEditor.getState().setContent(id, "SELECT 1");
    });
    render(<EditorTabs />);

    const closeBtn = screen.getByRole("button", { name: /editor.tabs.close/ });
    await userEvent.click(closeBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("editor.tabs.confirm_discard.title")).toBeInTheDocument();

    await userEvent.click(      within(dialog).getByRole("button", {
        name: "editor.tabs.confirm_discard.cancel",
      }),
);
    expect(useEditor.getState().tabs.find((t) => t.id === id)).toBeDefined();
  });

  test("close × on a dirty editor → Discard confirms and removes tab", async () => {
    let id = "";
    act(() => {
      id = useEditor.getState().openEditorTab(null).id;
      useEditor.getState().setContent(id, "SELECT 1");
    });
    render(<EditorTabs />);

    await userEvent.click(screen.getByRole("button", { name: /editor.tabs.close/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(      within(dialog).getByRole("button", {
        name: "editor.tabs.confirm_discard.confirm",
      }),
);

    expect(useEditor.getState().tabs.find((t) => t.id === id)).toBeUndefined();
  });

  test("editor.requestCloseActive event triggers same flow as ×", async () => {
    let id = "";
    act(() => {
      id = useEditor.getState().openEditorTab(null).id;
      useEditor.getState().setContent(id, "SELECT 1");
    });
    render(<EditorTabs />);

    act(() => {
      window.dispatchEvent(new Event("editor.requestCloseActive"));
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
  });

  test("dirty dot renders for dirty editor tabs", () => {
    let id = "";
    act(() => {
      id = useEditor.getState().openEditorTab(null).id;
      useEditor.getState().setContent(id, "SELECT 1");
    });
    render(<EditorTabs />);
    expect(screen.getByTestId(`editor-tab-dirty-${id}`)).toBeInTheDocument();
  });

  test("dirty guard fires for object-editor tabs", async () => {
    const { useObjectEditorStore } = await import("../object-editor/store");
    let id = "";
    act(() => {
      const tab = useEditor.getState().openObjectEditor({
        connectionId: "conn-1",
        objectKind: "table",
        mode: "create",
        schema: "public",
      });
      id = tab.id;
      useObjectEditorStore.getState().setForm(id, {
        kind: "table",
        form: {
          schema: "public",
          name: "t1",
          comment: null,
          columns: [],
          constraints: [],
          indexes: [],
          rls: { enabled: false, policies: [] },
          partition: null,
        },
        initial: null,
      });
    });
    render(<EditorTabs />);
    // Click ×
    const closeButton = screen.getByTestId(`editor-tab-close-${id}`);
    await userEvent.click(closeButton);

    // Discard-confirm dialog must appear instead of immediate close.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Tab must still be present until Discard is confirmed.
    expect(useEditor.getState().tabs.find((t) => t.id === id)).toBeDefined();
  });

  test("dirty dot renders for dirty object-editor tabs", async () => {
    const { useObjectEditorStore } = await import("../object-editor/store");
    let id = "";
    act(() => {
      const tab = useEditor.getState().openObjectEditor({
        connectionId: "conn-1",
        objectKind: "view",
        mode: "create",
        schema: "public",
      });
      id = tab.id;
      useObjectEditorStore.getState().setForm(id, {
        kind: "view",
        form: { schema: "public", name: "v", body: "SELECT 1" },
        initial: null,
      });
    });
    render(<EditorTabs />);
    expect(screen.getByTestId(`editor-tab-dirty-${id}`)).toBeInTheDocument();
  });

  test("history tab renders with the localized history.tab.title label", () => {
    act(() => {
      useEditor.getState().openHistoryTab();
    });
    render(<EditorTabs />);
    expect(screen.getByRole("tab", { name: /history.tab.title/ })).toBeInTheDocument();
  });

  test("close × on a history tab removes it from the strip", async () => {
    let id = "";
    act(() => {
      id = useEditor.getState().openHistoryTab().id;
    });
    render(<EditorTabs />);

    const closeBtn = screen.getByRole("button", {
      name: /editor.tabs.close/,
    });
    await userEvent.click(closeBtn);

    expect(useEditor.getState().tabs.find((t) => t.id === id)).toBeUndefined();
  });

  test("ERD tab renders with the localized erd.tab.title label", () => {
    act(() => {
      useEditor.getState().openErdTab("conn-1");
    });
    render(<EditorTabs />);
    expect(screen.getByTestId("editor-tab-erd-conn-1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /erd\.tab\.title/ })).toBeInTheDocument();
  });
});
