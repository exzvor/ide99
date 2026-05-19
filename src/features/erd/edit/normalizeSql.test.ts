import { describe, expect, it } from "vitest";
import { normalizeSql } from "./normalizeSql";

describe("normalizeSql", () => {
  it("trims and collapses multi-space + newline", () => {
    expect(normalizeSql("CREATE  TABLE\n  users  (id int)")).toBe("CREATE TABLE users(id int)");
  });

  it("treats text-equal SQL as equal after normalize", () => {
    expect(normalizeSql("a , b")).toBe(normalizeSql("a,b"));
    expect(normalizeSql("foo (bar)")).toBe(normalizeSql("foo(bar)"));
  });

  it("normalizes semicolons", () => {
    expect(normalizeSql("a ;\n b")).toBe(normalizeSql("a;b"));
  });

  it("preserves identifiers verbatim", () => {
    expect(normalizeSql('"weird name" int')).toBe('"weird name" int');
  });
});
