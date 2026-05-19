// — DataGrip / IntelliJ keymap.xml parser tests.
//
// Source shape (simplified):
// <keymap version="1" name="MyMap" parent="$default">
// <action id="EditorPaste">
// <keyboard-shortcut first-keystroke="meta V" />
// </action>
// <action id="GotoDeclaration">
// <keyboard-shortcut first-keystroke="meta b" second-keystroke="meta s" />
// </action>
// </keymap>
//
// IntelliJ's keystrokes are space-separated, lowercase modifier names: `meta`,
// `control`, `shift`, `alt`. We translate to our canonical `Cmd`, `Ctrl`,
// `Shift`, `Alt`.

import { describe, expect, it } from "vitest";

import { parseKeymap } from "../parsers";

const xml = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<keymap version="1" name="t">${body}</keymap>`;

describe("parseKeymap — datagrip", () => {
  it("extracts a single keyboard-shortcut", () => {
    const raw = xml(
      `<action id="EditorPaste"><keyboard-shortcut first-keystroke="meta V"/></action>`,
    );
    const result = parseKeymap("datagrip", raw);
    expect(result.format).toBe("datagrip");
    expect(result.bindings).toEqual([{ sequence: "Cmd+V", externalCommand: "EditorPaste" }]);
    expect(result.warnings).toEqual([]);
  });

  it("translates meta/control/shift/alt to Cmd/Ctrl/Shift/Alt", () => {
    const raw = xml(
      `<action id="A"><keyboard-shortcut first-keystroke="control shift alt P"/></action>`,
    );
    expect(parseKeymap("datagrip", raw).bindings[0].sequence).toBe("Ctrl+Alt+Shift+P");
  });

  it("combines first-keystroke + second-keystroke with a single space", () => {
    const raw = xml(
      `<action id="GotoDeclaration"><keyboard-shortcut first-keystroke="meta K" second-keystroke="meta S"/></action>`,
    );
    expect(parseKeymap("datagrip", raw).bindings[0].sequence).toBe("Cmd+K Cmd+S");
  });

  it("yields one binding per <keyboard-shortcut> when an action has multiple", () => {
    const raw = xml(`<action id="EditorCut">
         <keyboard-shortcut first-keystroke="meta X"/>
         <keyboard-shortcut first-keystroke="shift DELETE"/>
       </action>`);
    const { bindings } = parseKeymap("datagrip", raw);
    expect(bindings).toHaveLength(2);
    expect(bindings[0].externalCommand).toBe("EditorCut");
    expect(bindings[1].externalCommand).toBe("EditorCut");
  });

  it("normalises function keys + special key names", () => {
    const raw = xml(`<action id="Run"><keyboard-shortcut first-keystroke="control F5"/></action>
       <action id="Cancel"><keyboard-shortcut first-keystroke="ESCAPE"/></action>`);
    const seqs = parseKeymap("datagrip", raw).bindings.map((b) => b.sequence);
    expect(seqs).toEqual(["Ctrl+F5", "Escape"]);
  });

  it("preserves a single-letter key as upper-case", () => {
    const raw = xml(`<action id="A"><keyboard-shortcut first-keystroke="meta a"/></action>`);
    expect(parseKeymap("datagrip", raw).bindings[0].sequence).toBe("Cmd+A");
  });

  it("warns and skips an action without first-keystroke", () => {
    const raw = xml(`<action id="Broken"><keyboard-shortcut/></action>`);
    const { bindings, warnings } = parseKeymap("datagrip", raw);
    expect(bindings).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/first-keystroke/i);
  });

  it("warns and skips an action without an id", () => {
    const raw = xml(`<action><keyboard-shortcut first-keystroke="meta V"/></action>`);
    const { bindings, warnings } = parseKeymap("datagrip", raw);
    expect(bindings).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/id/i);
  });

  it("warns and skips when XML root is not <keymap>", () => {
    const raw = `<?xml version="1.0"?><other/>`;
    const { bindings, warnings } = parseKeymap("datagrip", raw);
    expect(bindings).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/keymap|root/i);
  });

  it("warns on malformed XML without throwing", () => {
    const raw = "<keymap><action"; // truncated
    const result = parseKeymap("datagrip", raw);
    expect(result.bindings).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("ignores <mouse-shortcut> entries (we only project keyboard)", () => {
    const raw = xml(`<action id="A">
         <mouse-shortcut keystroke="button1"/>
         <keyboard-shortcut first-keystroke="meta J"/>
       </action>`);
    const { bindings } = parseKeymap("datagrip", raw);
    expect(bindings).toEqual([{ sequence: "Cmd+J", externalCommand: "A" }]);
  });

  it("handles many actions in one document", () => {
    const body = Array.from(
      { length: 10 },
      (_, i) =>
        `<action id="Cmd${i}"><keyboard-shortcut first-keystroke="meta ${String.fromCharCode(65 + i)}"/></action>`,
    ).join("");
    const result = parseKeymap("datagrip", xml(body));
    expect(result.bindings).toHaveLength(10);
    expect(result.bindings[0]).toEqual({ sequence: "Cmd+A", externalCommand: "Cmd0" });
    expect(result.bindings[9]).toEqual({ sequence: "Cmd+J", externalCommand: "Cmd9" });
  });
});
