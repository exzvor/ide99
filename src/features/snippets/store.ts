/**
 * — User Snippets store.
 *
 * Wraps the Tauri commands `snippets_list / create / update / delete /
 * export / import` and merges the built-in template list with user
 * snippets. Prefix collisions resolve in favour of the user snippet — the
 * built-in is hidden so the palette + Monaco autocomplete pick up the
 * override transparently.
 *
 * Export / import use path-based wrappers (snippetsExport / snippetsImport
 * in lib/tauri.ts); the frontend just picks the path via the dialog
 * plugin. Plugin-fs is intentionally not used — the Rust side owns the
 * disk IO so the bundle format stays validated end-to-end.
 */

import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import {
  type NewUserSnippet,
  type UpdateUserSnippet,
  type UserSnippet,
  snippetsCreate,
  snippetsDelete,
  snippetsExport,
  snippetsImport,
  snippetsList,
  snippetsUpdate,
} from "../../lib/tauri";
import { BUILTIN_SNIPPETS } from "../editor/autocomplete/snippets";
import type { SnippetTemplate } from "../editor/autocomplete/types";

interface State {
  userSnippets: UserSnippet[];
  paletteOpen: boolean;
  loading: boolean;
  error: string | null;
}

interface Actions {
  load(): Promise<void>;
  create(input: NewUserSnippet): Promise<UserSnippet>;
  update(id: number, input: UpdateUserSnippet): Promise<UserSnippet>;
  delete(id: number): Promise<void>;
  openPalette(): void;
  closePalette(): void;
  exportToFile(): Promise<void>;
  importFromFile(): Promise<void>;
  /** Merged list — built-ins first; user prefixes win on collision. */
  getMerged(): readonly SnippetTemplate[];
}

export const useSnippets = create<State & Actions>((set, get) => ({
  userSnippets: [],
  paletteOpen: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const list = await snippetsList();
      set({ userSnippets: list, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  create: async (input) => {
    const created = await snippetsCreate(input);
    set((s) => ({ userSnippets: [created, ...s.userSnippets] }));
    return created;
  },

  update: async (id, input) => {
    const updated = await snippetsUpdate(id, input);
    set((s) => ({
      userSnippets: s.userSnippets.map((x) => (x.id === id ? updated : x)),
    }));
    return updated;
  },

  delete: async (id) => {
    await snippetsDelete(id);
    set((s) => ({ userSnippets: s.userSnippets.filter((x) => x.id !== id) }));
  },

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),

  exportToFile: async () => {
    const path = await saveDialog({
      title: "Export snippets",
      defaultPath: "snippets.ide99.json",
      filters: [{ name: "ide99 snippet bundle", extensions: ["json"] }],
    });
    if (!path) return;
    await snippetsExport(path);
  },

  importFromFile: async () => {
    const path = await openDialog({
      title: "Import snippets",
      multiple: false,
      filters: [{ name: "ide99 snippet bundle", extensions: ["json"] }],
    });
    if (!path || Array.isArray(path)) return;
    const imported = await snippetsImport(path);
    set((s) => ({ userSnippets: [...imported, ...s.userSnippets] }));
  },

  getMerged: () => {
    const userByPrefix = new Set<string>();
    const userTemplates: SnippetTemplate[] = get().userSnippets.map((u) => {
      userByPrefix.add(u.prefix);
      return {
        id: `user-${u.id}`,
        label: u.label,
        prefixes: [u.prefix],
        body: u.body,
        docI18nKey: "", // user docs are raw strings, see palette
        visibleIn: undefined,
      };
    });
    const builtinsFiltered = BUILTIN_SNIPPETS.filter(      (b) => !b.prefixes.some((p) => userByPrefix.has(p)),
);
    return Object.freeze([...builtinsFiltered, ...userTemplates]);
  },
}));
