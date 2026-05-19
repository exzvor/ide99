import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSnippets } from "./SettingsSnippets";
import { useSnippets } from "./store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "settings.snippets.title": "Snippets",
        "settings.snippets.builtins": `Built-ins (${opts?.count ?? "?"})`,
        "settings.snippets.mySnippets": `My snippets (${opts?.count ?? "?"})`,
        "settings.snippets.empty": "No snippets yet",
        "snippets.toolbar.new": "New",
        "snippets.toolbar.import": "Import",
        "snippets.toolbar.export": "Export",
        "snippets.editor.label": "Label",
        "snippets.editor.prefix": "Prefix",
        "snippets.editor.body": "Body",
        "snippets.editor.documentation": "Documentation",
        "snippets.editor.editTitle": "Edit snippet",
        "snippets.editor.newTitle": "New snippet",
        "common.cancel": "Cancel",
        "common.save": "Save",
        "common.create": "Create",
        "common.edit": "Edit",
        "common.delete": "Delete",
      };
      return map[key] ?? key;
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    snippetsList: vi.fn().mockResolvedValue([]),
    snippetsDelete: vi.fn().mockResolvedValue(undefined),
  };
});

describe("SettingsSnippets", () => {
  beforeEach(() => {
    useSnippets.setState({ userSnippets: [], paletteOpen: false, loading: false, error: null });
  });

  it("renders Built-ins details + empty state", async () => {
    render(<SettingsSnippets />);
    expect(await screen.findByText(/built-ins/i)).toBeInTheDocument();
    expect(screen.getByText(/empty|no.*snippets/i)).toBeInTheDocument();
  });

  it("New button opens editor", async () => {
    const user = userEvent.setup();
    render(<SettingsSnippets />);
    await user.click(screen.getByText(/^\+\s*New$/i));
    expect(screen.getByLabelText(/label/i)).toBeInTheDocument();
  });

  it("renders user snippet rows + delete invokes store.delete", async () => {
    useSnippets.setState({
      userSnippets: [
        {
          id: 1,
          label: "x",
          prefix: "x",
          body: "y",
          documentation: "",
          createdAt: "",
          updatedAt: "",
        },
      ],
      paletteOpen: false,
      loading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<SettingsSnippets />);
    await user.click(screen.getByText(/^Delete$/));
    await new Promise((r) => setTimeout(r, 0));
    expect(useSnippets.getState().userSnippets).toHaveLength(0);
  });
});
