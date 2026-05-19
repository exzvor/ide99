// — keymap parser dispatch test.

import { describe, expect, it } from "vitest";

import { parseKeymap } from "../parsers";

describe("parseKeymap — dispatch", () => {
  it("throws on an unknown format string", () => {
    // Forced cast: the type system normally forbids this, but we want to ensure
    // the runtime guard fires (the store's catch-all path depends on it).
    expect(() => parseKeymap("notepad" as unknown as "vscode", "")).toThrow(/format/);
  });
});
