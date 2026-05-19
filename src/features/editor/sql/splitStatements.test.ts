import { describe, expect, it } from "vitest";
import { splitStatements } from "./splitStatements";

describe("splitStatements", () => {
  it("returns one statement for a simple SELECT", () => {
    const r = splitStatements("SELECT 1");
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("SELECT 1");
    expect(r[0].startOffset).toBe(0);
    expect(r[0].endOffset).toBe(8);
    expect(r[0].startLine).toBe(1);
    expect(r[0].endLine).toBe(1);
  });

  it("trims trailing semicolon from text but includes it in offsets", () => {
    const r = splitStatements("SELECT 1;");
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("SELECT 1");
    expect(r[0].endOffset).toBe(9);
  });

  it("splits two simple statements on `;`", () => {
    const r = splitStatements("SELECT 1;\nSELECT 2");
    expect(r).toHaveLength(2);
    expect(r[0].text).toBe("SELECT 1");
    expect(r[1].text).toBe("SELECT 2");
    expect(r[1].startLine).toBe(2);
  });

  it("ignores `;` inside a single-quoted string", () => {
    const r = splitStatements("SELECT 'a;b' AS x");
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("SELECT 'a;b' AS x");
  });

  it("treats '' inside a single-quoted string as escaped quote", () => {
    const r = splitStatements("SELECT 'it''s'; SELECT 2");
    expect(r).toHaveLength(2);
    expect(r[0].text).toBe("SELECT 'it''s'");
    expect(r[1].text).toBe("SELECT 2");
  });

  it("ignores `;` inside a double-quoted identifier", () => {
    const r = splitStatements(`SELECT "col;name" FROM t`);
    expect(r).toHaveLength(1);
  });

  it("ignores `;` inside an untagged dollar-quoted block", () => {
    const r = splitStatements("SELECT $$body; with semis$$ AS x");
    expect(r).toHaveLength(1);
  });

  it("ignores `;` inside a tagged dollar-quoted block", () => {
    const r = splitStatements("SELECT $tag$body; tagged$tag$ AS x");
    expect(r).toHaveLength(1);
  });

  it("treats $$ inside a $tag$ block as plain text", () => {
    const r = splitStatements("SELECT $tag$ has $$ inside; $tag$ AS x");
    expect(r).toHaveLength(1);
  });

  it("handles E-strings with backslash escapes", () => {
    const r = splitStatements("SELECT E'foo\\\\;bar'; SELECT 2");
    expect(r).toHaveLength(2);
  });

  it("ignores `;` in line comments", () => {
    const r = splitStatements("SELECT 1 -- ;ignored\n;\nSELECT 2");
    expect(r).toHaveLength(2);
    expect(r[0].text).toBe("SELECT 1 -- ;ignored");
    expect(r[1].text).toBe("SELECT 2");
  });

  it("ignores `;` in block comments", () => {
    const r = splitStatements("SELECT 1 /* foo;bar */; SELECT 2");
    expect(r).toHaveLength(2);
  });

  it("supports nested block comments (PG-specific)", () => {
    const r = splitStatements("SELECT 1 /* a /* nested;in nested */ outer; */; SELECT 2");
    expect(r).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(splitStatements("")).toEqual([]);
  });

  it("returns empty array for whitespace-only", () => {
    expect(splitStatements("\n  \t  \n")).toEqual([]);
  });

  it("returns empty array for comments-only", () => {
    expect(splitStatements("-- just a comment\n/* block */")).toEqual([]);
  });

  it("handles unterminated single quote by treating rest as one statement", () => {
    const r = splitStatements("SELECT 'unclosed; SELECT 2");
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("SELECT 'unclosed; SELECT 2");
  });

  it("handles unterminated dollar-quote", () => {
    const r = splitStatements("SELECT $$unclosed; SELECT 2");
    expect(r).toHaveLength(1);
  });

  it("treats CRLF as whitespace", () => {
    const r = splitStatements("SELECT 1;\r\nSELECT 2");
    expect(r).toHaveLength(2);
  });

  it("handles plpgsql DO block as one statement", () => {
    const r = splitStatements("DO $$ BEGIN RAISE NOTICE 'x;y'; END $$;");
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("DO $$ BEGIN RAISE NOTICE 'x;y'; END $$");
  });

  it("trims leading/trailing whitespace inside text but preserves full-segment offsets", () => {
    const r = splitStatements("  SELECT 1  ;  SELECT 2  ");
    expect(r).toHaveLength(2);
    expect(r[0].text).toBe("SELECT 1");
    expect(r[1].text).toBe("SELECT 2");
    // text is trimmed for display, but startOffset/endOffset cover the FULL
    // segment (incl. surrounding whitespace) so statementAtCursor can map
    // a cursor in inter-statement whitespace to the surrounding statement
    // unambiguously.
    expect(r[0].startOffset).toBe(0); // segment starts at the first char
    expect(r[0].endOffset).toBe(13); // segment ends right after the first ';'
    expect(r[1].startOffset).toBe(13); // second segment picks up immediately after the first ';'
    expect(r[1].endOffset).toBe(25); // end of input (no trailing ';')
  });

  it("computes 1-indexed startLine/endLine for multi-line statement", () => {
    const r = splitStatements("SELECT 1,\n  2,\n  3");
    expect(r).toHaveLength(1);
    expect(r[0].startLine).toBe(1);
    expect(r[0].endLine).toBe(3);
  });

  it("real-world: CTE + SELECT + INSERT", () => {
    const sql = `WITH x AS (SELECT 1)
SELECT * FROM x;
INSERT INTO log VALUES('done');`;
    const r = splitStatements(sql);
    expect(r).toHaveLength(2);
    expect(r[0].text).toMatch(/^WITH x AS/);
    expect(r[1].text).toMatch(/^INSERT INTO log/);
  });
});
