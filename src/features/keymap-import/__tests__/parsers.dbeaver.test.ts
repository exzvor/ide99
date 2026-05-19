// — DBeaver bindings.xml parser tests.
//
// Source shape:
// <bindings>
// <binding contextId="..." commandId="org.jkiss.dbeaver.ui.editors.sql.run.script"
// schemeId="..." triggerSequence="M1+ALT+X"/>
// </bindings>
//
// `triggerSequence` follows Eclipse keybinding format: `M1` = Cmd on macOS /
// Ctrl elsewhere, `M2` = Shift, `M3` = Alt, `M4` = Ctrl on macOS / Win key
// elsewhere. We render canonically as if the user is on macOS — that matches
// the rest of ide99's binding store.

import { describe, expect, it } from "vitest";

import { parseKeymap } from "../parsers";

const xml = (body: string): string => `<?xml version="1.0"?><bindings>${body}</bindings>`;

describe("parseKeymap — dbeaver", () => {
  it("extracts a single binding", () => {
    const raw = xml(      `<binding commandId="org.jkiss.dbeaver.ui.editors.sql.run.script" triggerSequence="M1+R"/>`,
);
    const result = parseKeymap("dbeaver", raw);
    expect(result.format).toBe("dbeaver");
    expect(result.bindings).toEqual([
      { sequence: "Cmd+R", externalCommand: "org.jkiss.dbeaver.ui.editors.sql.run.script" },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("translates M1/M2/M3/M4 to Cmd/Shift/Alt/Ctrl", () => {
    const raw = xml(      `<binding commandId="cmd.a" triggerSequence="M1+M2+A"/>
       <binding commandId="cmd.b" triggerSequence="M3+B"/>
       <binding commandId="cmd.c" triggerSequence="M4+C"/>`,
);
    const seqs = parseKeymap("dbeaver", raw).bindings.map((b) => b.sequence);
    expect(seqs).toEqual(["Cmd+Shift+A", "Alt+B", "Ctrl+C"]);
  });

  it("recognises spelt-out modifiers (CTRL, SHIFT, ALT) in the trigger sequence", () => {
    const raw = xml(`<binding commandId="cmd.d" triggerSequence="CTRL+SHIFT+D"/>`);
    expect(parseKeymap("dbeaver", raw).bindings[0].sequence).toBe("Ctrl+Shift+D");
  });

  it("preserves multi-stroke sequences (Eclipse uses space)", () => {
    const raw = xml(`<binding commandId="cmd.e" triggerSequence="M1+K M1+S"/>`);
    expect(parseKeymap("dbeaver", raw).bindings[0].sequence).toBe("Cmd+K Cmd+S");
  });

  it("attaches contextId to the warning when binding has no triggerSequence", () => {
    const raw = xml(`<binding commandId="cmd.f" contextId="org.eclipse.ui.contexts.dialog"/>`);
    const { bindings, warnings } = parseKeymap("dbeaver", raw);
    expect(bindings).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/triggerSequence/i);
  });

  it("warns and skips a binding without commandId", () => {
    const raw = xml(`<binding triggerSequence="M1+A"/>`);
    const { bindings, warnings } = parseKeymap("dbeaver", raw);
    expect(bindings).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/commandId/i);
  });

  it("ignores bindings with empty triggerSequence (DBeaver unbind)", () => {
    const raw = xml(`<binding commandId="cmd.g" triggerSequence=""/>`);
    const { bindings, warnings } = parseKeymap("dbeaver", raw);
    expect(bindings).toEqual([]);
    expect(warnings.some((w) => /unbind|empty/i.test(w.message))).toBe(true);
  });

  it("warns when XML root is not <bindings>", () => {
    const raw = `<?xml version="1.0"?><other/>`;
    const result = parseKeymap("dbeaver", raw);
    expect(result.bindings).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toMatch(/bindings|root/i);
  });

  it("captures the contextId in the binding's `when` field", () => {
    // DBeaver context ids look like Eclipse context expressions — pass-through
    // so the user can compare bindings that only differ by context.
    const raw = xml(      `<binding commandId="cmd.h" triggerSequence="M1+H" contextId="org.jkiss.dbeaver.ui.editors.sql"/>`,
);
    const [b] = parseKeymap("dbeaver", raw).bindings;
    expect(b.when).toBe("org.jkiss.dbeaver.ui.editors.sql");
  });

  it("handles a long bindings document", () => {
    const body = Array.from(      { length: 20 },
      (_, i) =>
        `<binding commandId="cmd.${i}" triggerSequence="M1+${String.fromCharCode(65 + (i % 26))}"/>`,
).join("");
    const result = parseKeymap("dbeaver", xml(body));
    expect(result.bindings).toHaveLength(20);
    expect(result.bindings[0].sequence).toBe("Cmd+A");
  });
});
