// — owner: .
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../lib/tauri", () => ({
  queryExecute: vi.fn(),
}));

import { queryExecute } from "../../../lib/tauri";
import { runPreflightCheck } from "../preflightCheck";

const mockQueryExecute = vi.mocked(queryExecute);

function rowResult(value: string | null): Awaited<ReturnType<typeof queryExecute>> {
  return {
    columns: [],
    rows: [[value]],
    truncated: false,
    durationMs: 0,
    affectedRows: null,
    statusMessage: "ok",
  };
}

function emptyResult(): Awaited<ReturnType<typeof queryExecute>> {
  return {
    columns: [],
    rows: [],
    truncated: false,
    durationMs: 0,
    affectedRows: null,
    statusMessage: "ok",
  };
}

describe("runPreflightCheck", () => {
  beforeEach(() => {
    mockQueryExecute.mockReset();
  });

  test("aggregates the four query results into a PreflightResult", async () => {
    mockQueryExecute
      .mockResolvedValueOnce(rowResult("t"))
      .mockResolvedValueOnce(rowResult("12 MB"))
      .mockResolvedValueOnce(rowResult("3"))
      .mockResolvedValueOnce(rowResult("1"));

    const result = await runPreflightCheck("conn-1", "public", "metrics");

    expect(result).toEqual({
      hasPk: true,
      tableSize: "12 MB",
      indexCount: 3,
      fkCount: 1,
    });
    expect(mockQueryExecute).toHaveBeenCalledTimes(4);
  });

  test('treats "true" string as truthy for hasPk', async () => {
    mockQueryExecute
      .mockResolvedValueOnce(rowResult("true"))
      .mockResolvedValueOnce(rowResult("8 kB"))
      .mockResolvedValueOnce(rowResult("0"))
      .mockResolvedValueOnce(rowResult("0"));

    const result = await runPreflightCheck("conn-1", "public", "tiny");
    expect(result?.hasPk).toBe(true);
  });

  test('treats "f" as false for hasPk', async () => {
    mockQueryExecute
      .mockResolvedValueOnce(rowResult("f"))
      .mockResolvedValueOnce(rowResult("8 kB"))
      .mockResolvedValueOnce(rowResult("0"))
      .mockResolvedValueOnce(rowResult("0"));

    const result = await runPreflightCheck("conn-1", "public", "no_pk");
    expect(result?.hasPk).toBe(false);
  });

  test("treats missing/empty hasPk row as false", async () => {
    mockQueryExecute
      .mockResolvedValueOnce(emptyResult())
      .mockResolvedValueOnce(rowResult("8 kB"))
      .mockResolvedValueOnce(rowResult("0"))
      .mockResolvedValueOnce(rowResult("0"));

    const result = await runPreflightCheck("conn-1", "public", "no_pk");
    expect(result?.hasPk).toBe(false);
  });

  test("returns null when any underlying query rejects (permission denied path)", async () => {
    mockQueryExecute
      .mockResolvedValueOnce(rowResult("t"))
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(rowResult("3"))
      .mockResolvedValueOnce(rowResult("1"));

    const result = await runPreflightCheck("conn-1", "public", "metrics");
    expect(result).toBeNull();
  });

  test("falls back to safe defaults when count rows are missing", async () => {
    mockQueryExecute
      .mockResolvedValueOnce(rowResult("t"))
      .mockResolvedValueOnce(emptyResult())
      .mockResolvedValueOnce(emptyResult())
      .mockResolvedValueOnce(emptyResult());

    const result = await runPreflightCheck("conn-1", "public", "metrics");
    expect(result).toEqual({
      hasPk: true,
      tableSize: "—",
      indexCount: 0,
      fkCount: 0,
    });
  });
});
