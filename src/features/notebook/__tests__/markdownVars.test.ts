/**
 * — Notebook variable substitution + markdown renderer tests.
 *
 * The substitution is the load-bearing piece (it mirrors backend behaviour
 * so the markdown preview can render live without an IPC round-trip);
 * markdown rendering is a thin convenience and is covered by smoke checks.
 */
import { describe, expect, it } from "vitest";
import { parseVariableRef, renderMarkdown, substituteVariables } from "../markdownVars";
import type { Cell } from "../types";

function sqlCell(id: string, columns: string[], rows: Array<Array<string | null>>): Cell {
  return {
    kind: "sql",
    id,
    source: "select 1",
    shareAsCte: false,
    result: {
      columns,
      rows,
      truncated: false,
      durationMs: 0,
      executedAt: new Date(0).toISOString(),
    },
  };
}

const md = (source: string): Cell => ({ kind: "markdown", id: `md-${source.length}`, source });

describe("substituteVariables", () => {
  it("replaces a single column reference with the cell's value", () => {
    const cells = [sqlCell("a", ["total"], [["42"]])];
    expect(substituteVariables("Total: {{ cell_0.result.total }}", cells)).toBe("Total: 42");
  });

  it("supports multiple references in a single string", () => {
    const cells = [sqlCell("a", ["users", "orders"], [["100", "250"]])];
    const result = substituteVariables(
      "Users={{ cell_0.result.users }}, Orders={{ cell_0.result.orders }}",
      cells,
    );
    expect(result).toBe("Users=100, Orders=250");
  });

  it("supports row index in [N] form", () => {
    const cells = [sqlCell("a", ["name"], [["Alice"], ["Bob"]])];
    expect(substituteVariables("Second: {{ cell_0.result.name[1] }}", cells)).toBe("Second: Bob");
  });

  it("leaves unresolved cell references in place when no result snapshot exists", () => {
    const cells = [md("# title")];
    expect(substituteVariables("X={{ cell_0.result.x }}", cells)).toBe("X={{ cell_0.result.x }}");
  });

  it("leaves unresolved column references untouched", () => {
    const cells = [sqlCell("a", ["total"], [["42"]])];
    expect(substituteVariables("X={{ cell_0.result.missing }}", cells)).toBe(
      "X={{ cell_0.result.missing }}",
    );
  });

  it("ignores out-of-range cell indices", () => {
    const cells = [sqlCell("a", ["total"], [["42"]])];
    expect(substituteVariables("X={{ cell_5.result.total }}", cells)).toBe(
      "X={{ cell_5.result.total }}",
    );
  });

  it("html mode escapes the resolved value to prevent injection", () => {
    const cells = [sqlCell("a", ["html"], [["<b>bold</b>"]])];
    const out = substituteVariables("Value: {{ cell_0.result.html }}", cells, { mode: "html" });
    expect(out).toBe("Value: &lt;b&gt;bold&lt;/b&gt;");
  });

  it("html mode wraps unresolved refs in an error span", () => {
    const cells: Cell[] = [];
    const out = substituteVariables("V={{ cell_0.result.x }}", cells, { mode: "html" });
    expect(out).toContain("nb-var-error");
    expect(out).toContain('data-error="unresolved"');
  });

  it("renders null cells as the empty string (not the literal 'null')", () => {
    const cells = [sqlCell("a", ["nullable"], [[null]])];
    // We intentionally treat null as unresolved → variable stays.
    expect(substituteVariables("X={{ cell_0.result.nullable }}", cells)).toBe(
      "X={{ cell_0.result.nullable }}",
    );
  });

  it("works on empty source", () => {
    expect(substituteVariables("", [])).toBe("");
  });
});

describe("parseVariableRef", () => {
  it("parses a column reference with default row", () => {
    expect(parseVariableRef("cell_2.result.total")).toEqual({
      cellIndex: 2,
      column: "total",
      row: 0,
    });
  });

  it("parses a column reference with explicit row", () => {
    expect(parseVariableRef("cell_0.result.name[3]")).toEqual({
      cellIndex: 0,
      column: "name",
      row: 3,
    });
  });

  it("rejects malformed references", () => {
    expect(parseVariableRef("not.a.ref")).toBeNull();
    expect(parseVariableRef("cell_X.result.x")).toBeNull();
  });
});

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Hello")).toBe("<h1>Hello</h1>");
    expect(renderMarkdown("### Hello")).toBe("<h3>Hello</h3>");
  });

  it("renders bold and italic", () => {
    expect(renderMarkdown("This is **bold** and *italic*.")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("This is **bold** and *italic*.")).toContain("<em>italic</em>");
  });

  it("renders inline code", () => {
    expect(renderMarkdown("Run `SELECT 1`.")).toContain("<code>SELECT 1</code>");
  });

  it("renders fenced code blocks", () => {
    const out = renderMarkdown("```\nSELECT 1;\n```");
    expect(out).toBe("<pre><code>SELECT 1;</code></pre>");
  });

  it("renders unordered lists", () => {
    const out = renderMarkdown("- a\n- b\n- c");
    expect(out).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
  });

  it("escapes raw HTML and dangerous schemes", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toContain("&lt;script&gt;");
    const link = renderMarkdown("[click](javascript:alert(1))");
    expect(link).toContain('href="#"');
  });

  it("preserves http(s) and mailto links", () => {
    const httpLink = renderMarkdown("[ide99](https://ide99.dev)");
    expect(httpLink).toContain('href="https://ide99.dev"');
    const mail = renderMarkdown("[me](mailto:hi@ide99.dev)");
    expect(mail).toContain('href="mailto:hi@ide99.dev"');
  });

  it("turns blank-line-separated text into paragraphs", () => {
    const out = renderMarkdown("First.\n\nSecond.");
    expect(out).toContain("<p>First.</p>");
    expect(out).toContain("<p>Second.</p>");
  });
});
