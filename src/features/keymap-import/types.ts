// Keymap import DTOs.
//
// `KeyBinding` is our canonical normalized form — the parsers project
// VS Code's `keybindings.json`, DataGrip's `*.xml`, and DBeaver's
// `*.xml` into this shape.

export type ExternalKeymapFormat = "vscode" | "datagrip" | "dbeaver";

export type KeyBinding = {
  /** Canonical key sequence ("Cmd+K", "Ctrl+Shift+P", "Cmd+, S"). */
  sequence: string;
  /** External tool's command id (e.g. `editor.action.formatDocument`). */
  externalCommand: string;
  /** Optional context restriction from the source file ("editorTextFocus"). */
  when?: string;
};

export type ParseWarning = {
  /** Source line number when applicable. */
  line?: number;
  /** Fallback English message (kept for tests + when key is missing). */
  message: string;
  /** i18n key under `keymap_import.parser_warning.*`. UI prefers this when set. */
  key?: string;
  /** Interpolation params for the i18n key. */
  params?: Record<string, string | number>;
};

export type ParseResult = {
  format: ExternalKeymapFormat;
  /** Normalized bindings extracted from the source. */
  bindings: KeyBinding[];
  /** Human-readable warnings (unmappable commands, malformed entries). */
  warnings: ParseWarning[];
};
