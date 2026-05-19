// — Keymap import zustand store.
//
// scaffold: holds last-parsed result + import progress. // fills out per-format parsers + the apply-into-keybinding-store side.

import { create } from "zustand";

import type { ExternalKeymapFormat, ParseResult } from "./types";

type State = {
  parsed: ParseResult | null;
  parsing: boolean;
  parseError: string | null;
  parseFromText: (format: ExternalKeymapFormat, raw: string) => Promise<ParseResult>;
  reset: () => void;
};

export const useKeymapImport = create<State>((set) => ({
  parsed: null,
  parsing: false,
  parseError: null,

  parseFromText: async (format, raw) => {
    set({ parsing: true, parseError: null });
    try {
      // dynamic import so the parser bundle stays out of the main
      // chunk until the user actually opens Keymap Import.       // the per-format implementations.
      const mod = await import("./parsers");
      const result = mod.parseKeymap(format, raw);
      set({ parsed: result, parsing: false });
      return result;
    } catch (e) {
      const message = (e as { message?: string }).message ?? String(e);
      set({ parsed: null, parsing: false, parseError: message });
      throw e;
    }
  },

  reset: () => set({ parsed: null, parseError: null, parsing: false }),
}));
