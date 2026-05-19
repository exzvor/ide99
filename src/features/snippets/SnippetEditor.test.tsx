import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SnippetEditor } from "./SnippetEditor";
import { useSnippets } from "./store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // expose machine-friendly labels so getByLabelText / getByText work
      const map: Record<string, string> = {
        "snippets.editor.label": "Label",
        "snippets.editor.prefix": "Prefix",
        "snippets.editor.body": "Body",
        "snippets.editor.documentation": "Documentation",
        "snippets.editor.editTitle": "Edit snippet",
        "snippets.editor.newTitle": "New snippet",
        "common.cancel": "Cancel",
        "common.save": "Save",
        "common.create": "Create",
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
    snippetsCreate: vi.fn(async (input: typeof actual.newUserSnippetSchema._type) => ({
      id: 1,
      label: input.label,
      prefix: input.prefix,
      body: input.body,
      documentation: input.documentation ?? "",
      createdAt: "x",
      updatedAt: "x",
    })),
  };
});

describe("SnippetEditor", () => {
  beforeEach(() => {
    useSnippets.setState({ userSnippets: [], paletteOpen: false, loading: false, error: null });
  });

  it("create: rejects empty label", async () => {
    const user = userEvent.setup();
    render(<SnippetEditor open editing={null} onClose={() => {}} />);
    await user.click(screen.getByText(/create/i));
    expect(await screen.findByText(/label required/i)).toBeInTheDocument();
  });

  it("create: rejects invalid prefix (starting digit)", async () => {
    const user = userEvent.setup();
    render(<SnippetEditor open editing={null} onClose={() => {}} />);
    await user.type(screen.getByLabelText(/label/i), "x");
    await user.type(screen.getByLabelText(/prefix/i), "1abc");
    await user.type(screen.getByLabelText(/body/i), "SELECT 1");
    await user.click(screen.getByText(/create/i));
    expect(await screen.findByText(/must start with a letter/i)).toBeInTheDocument();
  });

  it("create: valid input calls store.create + closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SnippetEditor open editing={null} onClose={onClose} />);
    await user.type(screen.getByLabelText(/label/i), "My snip");
    await user.type(screen.getByLabelText(/prefix/i), "my");
    await user.type(screen.getByLabelText(/body/i), "SELECT 1");
    await user.click(screen.getByText(/create/i));
    await new Promise((r) => setTimeout(r, 0));
    expect(onClose).toHaveBeenCalled();
    expect(useSnippets.getState().userSnippets[0]?.label).toBe("My snip");
  });
});
