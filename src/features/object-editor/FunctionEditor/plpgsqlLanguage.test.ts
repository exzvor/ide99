// — PL/pgSQL Monarch grammar registration tests.
//
// Monaco isn't available in the jsdom test env (no real editor canvas);
// tests run against a mock that records the registration calls. Real
// tokenisation is verified manually inside the running app — see plan
// B4.T1 for rationale.

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  PLPGSQL_LANGUAGE_ID,
  __resetForTests,
  buildPlpgsqlMonarchLanguage,
  registerPlpgsqlLanguage,
} from "./plpgsqlLanguage";

function makeMockMonaco() {
  return {
    languages: {
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      IndentAction: { Indent: 1, None: 0 },
    },
  };
}

describe("registerPlpgsqlLanguage", () => {
  afterEach(() => {
    __resetForTests();
  });

  test("registers `plpgsql` as the language id", () => {
    const monaco = makeMockMonaco();
    registerPlpgsqlLanguage(monaco as never);

    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    const arg = monaco.languages.register.mock.calls[0][0] as { id: string };
    expect(arg.id).toBe(PLPGSQL_LANGUAGE_ID);
    expect(PLPGSQL_LANGUAGE_ID).toBe("plpgsql");
  });

  test("idempotent: calling twice registers only once", () => {
    const monaco = makeMockMonaco();
    registerPlpgsqlLanguage(monaco as never);
    registerPlpgsqlLanguage(monaco as never);

    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
  });

  test("Monarch tokenizer.root contains keyword/identifier/string/comment rules", () => {
    const monaco = makeMockMonaco();
    registerPlpgsqlLanguage(monaco as never);

    const provider = monaco.languages.setMonarchTokensProvider.mock.calls[0][1] as ReturnType<
      typeof buildPlpgsqlMonarchLanguage
    >;
    expect(provider.tokenizer).toBeDefined();
    expect(Array.isArray(provider.tokenizer.root)).toBe(true);
    // Stringified rules — keep assertion robust to minor reorder.
    const blob = JSON.stringify(provider.tokenizer.root);
    expect(blob).toContain("@keywords");
    expect(blob).toContain("@typeKeywords");
    expect(blob).toContain("identifier");
    expect(blob).toContain("comment");
    expect(blob).toContain("string.quote");
  });

  test("keyword set includes core PL/pgSQL keywords", () => {
    const lang = buildPlpgsqlMonarchLanguage();
    for (const kw of ["BEGIN", "END", "RAISE", "DECLARE", "RETURN"]) {
      expect(lang.keywords).toContain(kw);
    }
  });

  test("type keyword set includes common SQL types", () => {
    const lang = buildPlpgsqlMonarchLanguage();
    for (const t of ["TEXT", "INTEGER", "JSONB"]) {
      expect(lang.typeKeywords).toContain(t);
    }
  });

  test("dollarString state defined for $tag$...$tag$ stateful matching", () => {
    const lang = buildPlpgsqlMonarchLanguage();
    expect(lang.tokenizer.dollarString).toBeDefined();
    expect(Array.isArray(lang.tokenizer.dollarString)).toBe(true);
    // Closing sentinel rule must reference the captured tag (`$1==$S2`).
    const blob = JSON.stringify(lang.tokenizer.dollarString);
    expect(blob).toContain("$1==$S2");
  });
});
