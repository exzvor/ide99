import { describe, expect, test, vi } from "vitest";

/**
 * Regression for audit fix: Tauri `invoke()` resolves to `null` for Rust
 * commands that return `()`, but we used `z.void()` which only matches
 * `undefined`. Every successful no-result call (delete, disconnect, tabs_save,
 * tabs_delete) was rejected with a confusing zod error that buried the real
 * outcome — the user saw "Expected void, received null" and assumed the
 * operation failed.
 *
 * The fix introduces an `emptyResultSchema` that accepts null / undefined /
 * void uniformly. These tests pin down its behavior so we don't regress to
 * `z.void()` in a future refactor.
 */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  QueryError,
  deleteConnection,
  queryCancel,
  queryCloseCursor,
  queryFetchPage,
  queryOpenCursor,
  tabsDelete,
} from "./tauri";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

describe("emptyResultSchema (regression for Tauri null vs zod void)", () => {
  test("deleteConnection accepts null Tauri response without throwing zod error", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce(null);
    await expect(deleteConnection("any-id")).resolves.toBeUndefined();
  });

  test("deleteConnection accepts undefined Tauri response", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(deleteConnection("any-id")).resolves.toBeUndefined();
  });

  test("tabsDelete accepts null Tauri response", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce(null);
    await expect(tabsDelete("any-id")).resolves.toBeUndefined();
  });
});

describe("cursor wrappers", () => {
  test("queryOpenCursor passes args + parses OpenCursorResult", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce({
      cursorId: "c_abc",
      columns: [{ name: "i", typeName: "int4", isNumeric: true }],
      firstPage: { rows: [["1"], ["2"]], exhausted: false },
      durationMs: 7,
      affectedRows: null,
      statusMessage: "SELECT",
    });
    const r = await queryOpenCursor("conn-1", "SELECT 1");
    expect(invokeMock).toHaveBeenCalledWith("query_open_cursor", {
      connId: "conn-1",
      sql: "SELECT 1",
    });
    expect(r.cursorId).toBe("c_abc");
    expect(r.firstPage.rows).toHaveLength(2);
  });

  test("queryFetchPage returns FetchPage", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce({ rows: [["a"]], exhausted: true });
    const r = await queryFetchPage("c_abc", 1000);
    expect(invokeMock).toHaveBeenCalledWith("query_fetch_page", {
      cursorId: "c_abc",
      limit: 1000,
    });
    expect(r.exhausted).toBe(true);
  });

  test("queryCancel accepts null Tauri response (regression: zod void)", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce(null);
    await expect(queryCancel("c_abc")).resolves.toBeUndefined();
  });

  test("queryCloseCursor accepts null Tauri response", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce(null);
    await expect(queryCloseCursor("c_abc")).resolves.toBeUndefined();
  });

  test("Cancelled QueryError surfaces as instanceof QueryError with kind=cancelled", async () => {
    invokeMock.mockReset();
    invokeMock.mockRejectedValueOnce({ kind: "cancelled" });
    try {
      await queryFetchPage("c_abc", 1000);
      throw new Error("expected throw");
    } catch (err) {
      if (!(err instanceof QueryError)) throw err;
      expect(err.kind).toBe("cancelled");
    }
  });

  test("CursorNotFound carries cursorId on the typed error", async () => {
    invokeMock.mockReset();
    invokeMock.mockRejectedValueOnce({
      kind: "cursorNotFound",
      cursorId: "c_lost",
    });
    try {
      await queryFetchPage("c_lost", 1000);
      throw new Error("expected throw");
    } catch (err) {
      if (!(err instanceof QueryError)) throw err;
      expect(err.kind).toBe("cursorNotFound");
      expect(err.cursorId).toBe("c_lost");
    }
  });
});
