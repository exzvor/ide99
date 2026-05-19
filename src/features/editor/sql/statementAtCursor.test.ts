import { describe, expect, it } from "vitest";
import { splitStatements, statementAtCursor } from "./splitStatements";

describe("statementAtCursor", () => {
  const sql = "SELECT 1;\nSELECT 2;\nSELECT 3";
  const stmts = splitStatements(sql);

  it("returns null on empty input", () => {
    expect(statementAtCursor([], 0)).toBeNull();
  });

  it("returns the statement when cursor is inside it", () => {
    expect(statementAtCursor(stmts, 3)?.text).toBe("SELECT 1"); // inside #1
    expect(statementAtCursor(stmts, 13)?.text).toBe("SELECT 2"); // inside #2
    expect(statementAtCursor(stmts, 24)?.text).toBe("SELECT 3"); // inside #3
  });

  it("returns the next statement when cursor is in inter-statement whitespace", () => {
    // cursor offset 9 is the '\n' right after the first ';'.
    expect(statementAtCursor(stmts, 9)?.text).toBe("SELECT 1");
    // offset 10 is start of "SELECT 2"
    expect(statementAtCursor(stmts, 10)?.text).toBe("SELECT 2");
  });

  it("returns the last statement when cursor is past the final character", () => {
    expect(statementAtCursor(stmts, sql.length)?.text).toBe("SELECT 3");
  });

  it("returns the next statement when cursor is in a leading comment", () => {
    const sql2 = "-- header\nSELECT 1";
    const s = splitStatements(sql2);
    expect(statementAtCursor(s, 3)?.text).toBe("SELECT 1");
  });
});
