// — VS Code keybindings.json parser tests.
//
// Source format: a JSON array of entries `{ key, command, when? }`.
// - `key` is the chord string ("ctrl+shift+p", "cmd+k cmd+s", "ctrl+/" etc).
// - `command` is the VS Code command id (preserved verbatim).
// - `when` is an arbitrary VS Code context expression — preserved verbatim.
//
// The parser normalises modifier names (cmd → Cmd, ctrl → Ctrl, shift → Shift,
// alt → Alt) into our canonical sequence form. Multi-keystroke chords are
// collapsed by VS Code's own space separator, so `cmd+k cmd+s` → `Cmd+K Cmd+S`.

import { describe, expect, it } from "vitest";

import { parseKeymap } from "../parsers";

describe("parseKeymap — vscode", () => {
  it("parses a single binding into canonical form", () => {
    const raw = JSON.stringify([{ key: "cmd+shift+p", command: "workbench.action.showCommands" }]);
    const result = parseKeymap("vscode", raw);
    expect(result.format).toBe("vscode");
    expect(result.bindings).toEqual([
      {
        sequence: "Cmd+Shift+P",
        externalCommand: "workbench.action.showCommands",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("normalises modifier order (Cmd, Ctrl, Alt, Shift, then key)", () => {
    const raw = JSON.stringify([
      { key: "shift+alt+cmd+f", command: "editor.action.formatDocument" },
    ]);
    const { bindings } = parseKeymap("vscode", raw);
    expect(bindings[0].sequence).toBe("Cmd+Alt+Shift+F");
  });

  it("preserves a multi-chord sequence with space separator", () => {
    const raw = JSON.stringify([
      { key: "cmd+k cmd+s", command: "workbench.action.openGlobalKeybindings" },
    ]);
    const { bindings } = parseKeymap("vscode", raw);
    expect(bindings[0].sequence).toBe("Cmd+K Cmd+S");
  });

  it("preserves an explicit `when` clause verbatim", () => {
    const raw = JSON.stringify([
      {
        key: "ctrl+enter",
        command: "ide.runQuery",
        when: "editorTextFocus && !suggestWidgetVisible",
      },
    ]);
    const [b] = parseKeymap("vscode", raw).bindings;
    expect(b.when).toBe("editorTextFocus && !suggestWidgetVisible");
  });

  it("strips entries that begin with `-` (VS Code unbinds)", () => {
    const raw = JSON.stringify([
      { key: "cmd+p", command: "-workbench.action.quickOpen" },
      { key: "cmd+p", command: "ide.openTab" },
    ]);
    const { bindings, warnings } = parseKeymap("vscode", raw);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].externalCommand).toBe("ide.openTab");
    expect(warnings.some((w) => /unbind/i.test(w.message))).toBe(true);
  });

  it("soft-fails on entries with missing fields rather than throwing", () => {
    const raw = JSON.stringify([
      { key: "cmd+s", command: "ide.save" },
      { key: "" }, // missing command + empty key
      { command: "ide.foo" }, // missing key
      "not an object", // garbage
    ]);
    const result = parseKeymap("vscode", raw);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].externalCommand).toBe("ide.save");
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("returns a single warning when the JSON is malformed", () => {
    const result = parseKeymap("vscode", "{ broken json :::");
    expect(result.bindings).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toMatch(/json/i);
  });

  it("returns a warning when the root is not an array", () => {
    const result = parseKeymap("vscode", JSON.stringify({ key: "cmd+s", command: "save" }));
    expect(result.bindings).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toMatch(/array/i);
  });

  it("ignores VS Code-style // line comments and trailing commas", () => {
    // VS Code's keybindings.json is `jsonc`. We don't pull a JSONC parser —
    // we strip line comments + trailing commas before JSON.parse.
    const raw = `[
      // open the command palette
      { "key": "cmd+shift+p", "command": "workbench.action.showCommands" },
    ]`;
    const { bindings, warnings } = parseKeymap("vscode", raw);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].sequence).toBe("Cmd+Shift+P");
    expect(warnings).toEqual([]);
  });

  it("upper-cases single-char keys (Cyrillic preserved as-is)", () => {
    // VS Code uses lowercase ascii for letter keys; for parity with our other
    // canonical bindings ("Cmd+P") we upper-case the trailing letter. Cyrillic
    // keys flow through unchanged.
    const raw = JSON.stringify([
      { key: "cmd+p", command: "ide.openTab" },
      { key: "cmd+ф", command: "ide.openTab.ru" },
    ]);
    const { bindings } = parseKeymap("vscode", raw);
    expect(bindings[0].sequence).toBe("Cmd+P");
    expect(bindings[1].sequence).toMatch(/Cmd\+[Фф]/u);
  });

  it("treats `meta` as `Cmd` (alias used in some VS Code keybindings)", () => {
    const raw = JSON.stringify([{ key: "meta+s", command: "save" }]);
    expect(parseKeymap("vscode", raw).bindings[0].sequence).toBe("Cmd+S");
  });

  it("renders special keys with their canonical name (Enter, Escape, ArrowUp)", () => {
    const raw = JSON.stringify([
      { key: "ctrl+enter", command: "run" },
      { key: "escape", command: "cancel" },
      { key: "ctrl+up", command: "scroll" },
    ]);
    const { bindings } = parseKeymap("vscode", raw);
    expect(bindings.map((b) => b.sequence)).toEqual(["Ctrl+Enter", "Escape", "Ctrl+ArrowUp"]);
  });
});
