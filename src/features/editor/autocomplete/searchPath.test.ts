import { describe, expect, it } from "vitest";
import { parseSearchPathFromSql } from "./searchPath";

describe("parseSearchPathFromSql", () => {
  it("returns null for unrelated SQL", () => {
    expect(parseSearchPathFromSql("SELECT * FROM users")).toBeNull();
  });

  it("parses SET search_path TO a, b", () => {
    expect(parseSearchPathFromSql("SET search_path TO app, public")).toEqual(["app", "public"]);
  });

  it("parses SET search_path = a, b", () => {
    expect(parseSearchPathFromSql("SET search_path = sales, public")).toEqual(["sales", "public"]);
  });

  it("parses SET LOCAL search_path TO a, b", () => {
    expect(parseSearchPathFromSql("SET LOCAL search_path TO foo, bar")).toEqual(["foo", "bar"]);
  });

  it("parses SET SESSION search_path TO a", () => {
    expect(parseSearchPathFromSql("SET SESSION search_path TO solo")).toEqual(["solo"]);
  });

  it("strips quotes from quoted schema names", () => {
    expect(parseSearchPathFromSql('SET search_path TO "Sales", public')).toEqual([
      "Sales",
      "public",
    ]);
  });

  it("ignores SET search_path that appears inside a CTE name", () => {
    // The token stream sees `with` not `set`; therefore returns null.
    expect(      parseSearchPathFromSql("WITH search_path AS (SELECT 1) SELECT * FROM search_path"),
).toBeNull();
  });

  it("ignores SET search_path inside a string literal", () => {
    expect(parseSearchPathFromSql("SELECT 'SET search_path TO foo'")).toBeNull();
  });

  it("returns the last SET when SQL has multiple statements", () => {
    const sql = "SET search_path = first; SET search_path = second";
    expect(parseSearchPathFromSql(sql)).toEqual(["second"]);
  });

  it("handles trailing semicolon and whitespace", () => {
    expect(parseSearchPathFromSql("  SET search_path TO public  ;  ")).toEqual(["public"]);
  });
});
