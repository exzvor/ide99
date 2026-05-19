// Per-format keymap parsers .
//
// Each parser takes raw text and returns `ParseResult` — bindings + warnings.
// All three normalise into the canonical `KeyBinding.sequence` form:
//
// "Cmd+Shift+P"            single-chord
// "Cmd+K Cmd+S"            multi-chord, space-separated
//
// Modifier order is fixed: `Cmd, Ctrl, Alt, Shift`, then the trailing key.
// We do not depend on an external XML / JSONC library — DOMParser ships in
// every browser and in jsdom (used for tests). For VS Code's `jsonc` we strip
// `//` line comments + trailing commas before delegating to JSON.parse.
//
// Parser philosophy: soft-fail on individual malformed entries (push to
// `warnings` array; do not throw). Hard-throw only on `parseKeymap()` being
// called with an unknown `format` argument — that's a programmer error.

import type { ExternalKeymapFormat, KeyBinding, ParseResult, ParseWarning } from "./types";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function parseKeymap(format: ExternalKeymapFormat, raw: string): ParseResult {
  switch (format) {
    case "vscode":
      return parseVscode(raw);
    case "datagrip":
      return parseDatagrip(raw);
    case "dbeaver":
      return parseDbeaver(raw);
    default:
      throw new Error(`unknown keymap format: ${format as string}`);
  }
}

// ---------------------------------------------------------------------------
// Canonical sequence helpers (shared by all parsers)
// ---------------------------------------------------------------------------

const MOD_ORDER: ReadonlyArray<"Cmd" | "Ctrl" | "Alt" | "Shift"> = ["Cmd", "Ctrl", "Alt", "Shift"];

/**
 * Map a lower-case modifier token (`cmd`, `meta`, `m1`, `control`, `ctrl`,
 * `m2`/`shift`, `m3`/`alt`/`option`, `m4`) to its canonical name. Returns
 * `null` if the token is not a recognised modifier — the caller treats it
 * as a literal key.
 */
function canonicalModifier(token: string): "Cmd" | "Ctrl" | "Alt" | "Shift" | null {
  switch (token.toLowerCase()) {
    case "cmd":
    case "command":
    case "meta":
    case "m1":
    case "win":
      return "Cmd";
    case "ctrl":
    case "control":
    case "m4":
      return "Ctrl";
    case "alt":
    case "option":
    case "opt":
    case "m3":
      return "Alt";
    case "shift":
    case "m2":
      return "Shift";
    default:
      return null;
  }
}

/** Map a key token to its canonical render. ASCII letters → upper-case;
 * named keys (`enter`, `escape`, `up`/`down`/`left`/`right`, function keys,
 * arrows, `tab`, `space`, …) → CamelCase; anything else passes through. */
function canonicalKey(token: string): string {
  if (token.length === 0) return token;
  const lower = token.toLowerCase();
  switch (lower) {
    case "enter":
    case "return":
      return "Enter";
    case "escape":
    case "esc":
      return "Escape";
    case "tab":
      return "Tab";
    case "space":
    case "spacebar":
      return "Space";
    case "delete":
    case "del":
      return "Delete";
    case "backspace":
      return "Backspace";
    case "home":
      return "Home";
    case "end":
      return "End";
    case "pageup":
    case "page_up":
      return "PageUp";
    case "pagedown":
    case "page_down":
      return "PageDown";
    case "up":
      return "ArrowUp";
    case "down":
      return "ArrowDown";
    case "left":
      return "ArrowLeft";
    case "right":
      return "ArrowRight";
    case "insert":
    case "ins":
      return "Insert";
    default:
      // Function key: f1..f24
      if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
      // Single ASCII letter → upper-case (matches VS Code/IntelliJ display).
      if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
      // Otherwise pass through (digits, punctuation, Cyrillic, etc).
      return token;
  }
}

/**
 * Normalise a single chord string (no spaces) — splits on `+` (and IntelliJ's
 * space-separated keystroke parts use a different splitter at a higher level).
 * Returns the canonical chord, e.g. "Cmd+Shift+P".
 */
function canonicaliseChord(chord: string, separator: RegExp): string {
  const parts = chord
    .split(separator)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const mods = new Set<"Cmd" | "Ctrl" | "Alt" | "Shift">();
  let key = "";
  for (const part of parts) {
    const mod = canonicalModifier(part);
    if (mod) {
      mods.add(mod);
    } else {
      // First non-modifier token wins as the key. If a second one shows up,
      // we treat it as a follow-up part of the key (rare; mostly belt-and-
      // braces for unusual inputs).
      key = key === "" ? canonicalKey(part) : `${key}${canonicalKey(part)}`;
    }
  }
  const orderedMods = MOD_ORDER.filter((m) => mods.has(m));
  return [...orderedMods, key].filter((s) => s.length > 0).join("+");
}

// ---------------------------------------------------------------------------
// VS Code (keybindings.json — JSONC)
// ---------------------------------------------------------------------------

function parseVscode(raw: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const bindings: KeyBinding[] = [];

  const stripped = stripJsonc(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    const detail = (e as Error).message;
    warnings.push({
      message: `JSON parse error: ${detail}`,
      key: "keymap_import.parser_warning.json_parse",
      params: { detail },
    });
    return { format: "vscode", bindings, warnings };
  }
  if (!Array.isArray(parsed)) {
    warnings.push({
      message: "VS Code keymap root must be an array of {key, command, when?}",
      key: "keymap_import.parser_warning.root_must_be_array",
    });
    return { format: "vscode", bindings, warnings };
  }

  parsed.forEach((entry, idx) => {
    if (typeof entry !== "object" || entry === null) {
      warnings.push({
        message: `entry[${idx}]: not an object — skipped`,
        key: "keymap_import.parser_warning.entry_not_object",
        params: { idx },
      });
      return;
    }
    const e = entry as { key?: unknown; command?: unknown; when?: unknown };
    const key = typeof e.key === "string" ? e.key.trim() : "";
    const command = typeof e.command === "string" ? e.command.trim() : "";
    if (key === "" || command === "") {
      warnings.push({
        message: `entry[${idx}]: missing key or command — skipped`,
        key: "keymap_import.parser_warning.missing_key_or_command",
        params: { idx },
      });
      return;
    }
    if (command.startsWith("-")) {
      warnings.push({
        message: `entry[${idx}]: VS Code unbind '${command}' — skipped`,
        key: "keymap_import.parser_warning.vscode_unbind",
        params: { idx, command },
      });
      return;
    }
    const sequence = canonicaliseVscodeKey(key);
    const binding: KeyBinding = { sequence, externalCommand: command };
    if (typeof e.when === "string" && e.when.trim().length > 0) {
      binding.when = e.when;
    }
    bindings.push(binding);
  });

  return { format: "vscode", bindings, warnings };
}

/** VS Code chord syntax: each chord is `mod+mod+key`; chords separated by space. */
function canonicaliseVscodeKey(key: string): string {
  const chords = key.split(/\s+/).filter((c) => c.length > 0);
  return chords.map((c) => canonicaliseChord(c, /\+/)).join(" ");
}

/**
 * Strip line comments and trailing commas so JSON.parse accepts VS Code's
 * `keybindings.json` (jsonc). Block comments and string-literal handling are
 * minimal but sufficient for VS Code's idiomatic file:
 * - `//` line comment outside of strings
 * - `/* … *​/` block comment outside of strings
 * - trailing comma before `]` or `}`
 *
 * Strings (incl. escaped quotes) are skipped over so a `"//"` inside a string
 * literal isn't mistaken for a comment.
 */
function stripJsonc(input: string): string {
  let out = "";
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    // String literal (double-quoted) — copy verbatim.
    if (ch === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (input[i] === "\\") {
          i += 2;
          continue;
        }
        if (input[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += input.slice(start, i);
      continue;
    }
    // Line comment.
    if (ch === "/" && input[i + 1] === "/") {
      while (i < n && input[i] !== "\n") i++;
      continue;
    }
    // Block comment.
    if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < n && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  // Strip trailing commas before `]` or `}`.
  return out.replace(/,(\s*[\]}])/g, "$1");
}

// ---------------------------------------------------------------------------
// DataGrip / IntelliJ keymap.xml
// ---------------------------------------------------------------------------

function parseDatagrip(raw: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const bindings: KeyBinding[] = [];

  const doc = parseXml(raw, warnings);
  if (!doc) return { format: "datagrip", bindings, warnings };

  if (doc.documentElement.tagName !== "keymap") {
    const tag = doc.documentElement.tagName;
    warnings.push({
      message: `expected <keymap> root, got <${tag}>`,
      key: "keymap_import.parser_warning.root_must_be_keymap",
      params: { tag },
    });
    return { format: "datagrip", bindings, warnings };
  }

  const actions = doc.getElementsByTagName("action");
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const id = action.getAttribute("id");
    const shortcuts = action.getElementsByTagName("keyboard-shortcut");
    if (!id) {
      if (shortcuts.length > 0) {
        warnings.push({
          message: "<action> missing id attribute — skipped",
          key: "keymap_import.parser_warning.action_missing_id",
        });
      }
      continue;
    }
    for (let s = 0; s < shortcuts.length; s++) {
      const shortcut = shortcuts[s];
      const first = shortcut.getAttribute("first-keystroke");
      const second = shortcut.getAttribute("second-keystroke");
      if (!first) {
        warnings.push({
          message: `<action id="${id}">: missing first-keystroke — skipped`,
          key: "keymap_import.parser_warning.missing_first_keystroke",
          params: { id },
        });
        continue;
      }
      const seq = [first, second]
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => canonicaliseChord(p, /\s+/))
        .join(" ");
      bindings.push({ sequence: seq, externalCommand: id });
    }
  }

  return { format: "datagrip", bindings, warnings };
}

// ---------------------------------------------------------------------------
// DBeaver bindings.xml
// ---------------------------------------------------------------------------

function parseDbeaver(raw: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const bindings: KeyBinding[] = [];

  const doc = parseXml(raw, warnings);
  if (!doc) return { format: "dbeaver", bindings, warnings };

  if (doc.documentElement.tagName !== "bindings") {
    const tag = doc.documentElement.tagName;
    warnings.push({
      message: `expected <bindings> root, got <${tag}>`,
      key: "keymap_import.parser_warning.root_must_be_bindings",
      params: { tag },
    });
    return { format: "dbeaver", bindings, warnings };
  }

  const entries = doc.getElementsByTagName("binding");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const command = entry.getAttribute("commandId");
    const trigger = entry.getAttribute("triggerSequence");
    const context = entry.getAttribute("contextId");
    if (!command) {
      warnings.push({
        message: "<binding>: missing commandId — skipped",
        key: "keymap_import.parser_warning.binding_missing_command_id",
      });
      continue;
    }
    if (trigger === null) {
      warnings.push({
        message: `<binding commandId="${command}">: missing triggerSequence — skipped`,
        key: "keymap_import.parser_warning.binding_missing_trigger",
        params: { command },
      });
      continue;
    }
    if (trigger.trim().length === 0) {
      warnings.push({
        message: `<binding commandId="${command}">: empty triggerSequence (DBeaver unbind) — skipped`,
        key: "keymap_import.parser_warning.binding_empty_trigger",
        params: { command },
      });
      continue;
    }
    const sequence = trigger
      .split(/\s+/)
      .filter((c) => c.length > 0)
      .map((chord) => canonicaliseChord(chord, /\+/))
      .join(" ");
    const binding: KeyBinding = { sequence, externalCommand: command };
    if (context && context.trim().length > 0) {
      binding.when = context;
    }
    bindings.push(binding);
  }

  return { format: "dbeaver", bindings, warnings };
}

// ---------------------------------------------------------------------------
// XML parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse `raw` with the platform DOMParser. Returns the document on success or
 * `null` after pushing a warning. DOMParser surfaces parse failures by
 * embedding a `<parsererror>` element in the result rather than throwing —
 * we detect that and convert to a warning.
 */
function parseXml(raw: string, warnings: ParseWarning[]): Document | null {
  if (typeof DOMParser === "undefined") {
    warnings.push({
      message: "DOMParser is not available in this runtime",
      key: "keymap_import.parser_warning.dom_parser_unavailable",
    });
    return null;
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(raw, "application/xml");
  } catch (e) {
    const detail = (e as Error).message;
    warnings.push({
      message: `XML parse error: ${detail}`,
      key: "keymap_import.parser_warning.xml_parse",
      params: { detail },
    });
    return null;
  }
  const errs = doc.getElementsByTagName("parsererror");
  if (errs.length > 0) {
    const detail = errs[0].textContent ?? "malformed XML";
    warnings.push({
      message: `XML parse error: ${detail}`,
      key: "keymap_import.parser_warning.xml_parse",
      params: { detail },
    });
    return null;
  }
  return doc;
}
