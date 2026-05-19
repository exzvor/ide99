// — Keymap import (VS Code / DataGrip / DBeaver formats).
//
// Parses external keymap files and produces a normalized binding list that
// the user can review before applying into ide99's own keybinding store.

export { KeymapImportDialog } from "./KeymapImportDialog";
export { useKeymapImport } from "./store";
export type { ExternalKeymapFormat, KeyBinding, ParseResult } from "./types";
