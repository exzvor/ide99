// — : tests for the per-policy state loaders.
// Strategy: mock `queryExecute` from `lib/tauri` and feed each loader a
// fixture row matching `timescaledb_information.jobs`'s shape.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryExecuteMock = vi.fn();
vi.mock("../../../lib/tauri", () => ({
  queryExecute: (...args: unknown[]) => queryExecuteMock(...args),
}));

import { loadCompressionPolicy, loadRefreshPolicy, loadRetentionPolicy } from "../policyState";

function jobsResult(rows: (string | null)[][]) {
  return {
    columns: [
      { name: "job_id", typeName: "int4", isNumeric: true },
      { name: "config", typeName: "jsonb", isNumeric: false },
      { name: "schedule_interval", typeName: "interval", isNumeric: false },
    ],
    rows,
    truncated: false,
    durationMs: 1,
    affectedRows: null,
    statusMessage: "ok",
  };
}

beforeEach(() => {
  queryExecuteMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadCompressionPolicy", () => {
  it("parses compress_after from the config JSON", async () => {
    queryExecuteMock.mockResolvedValueOnce(      jobsResult([
        ["1001", JSON.stringify({ hypertable_id: 5, compress_after: "7 days" }), "12:00:00"],
      ]),
);
    const policy = await loadCompressionPolicy("conn-1", "public", "metrics");
    expect(policy).toEqual({ jobId: 1001, compressAfter: "7 days" });

    // The query targeted the right proc + table.
    const sql = queryExecuteMock.mock.calls[0]?.[1] as string;
    expect(sql).toContain("policy_compression");
    expect(sql).toContain("hypertable_schema = 'public'");
    expect(sql).toContain("hypertable_name = 'metrics'");
  });

  it("strips the leading '@ ' Postgres interval prefix", async () => {
    queryExecuteMock.mockResolvedValueOnce(      jobsResult([["42", JSON.stringify({ compress_after: "@ 14 days" }), "12:00:00"]]),
);
    const policy = await loadCompressionPolicy("conn-1", "public", "metrics");
    expect(policy).toEqual({ jobId: 42, compressAfter: "14 days" });
  });

  it("returns null when no rows match", async () => {
    queryExecuteMock.mockResolvedValueOnce(jobsResult([]));
    const policy = await loadCompressionPolicy("conn-1", "public", "metrics");
    expect(policy).toBeNull();
  });

  it("returns null on permission-denied without throwing", async () => {
    queryExecuteMock.mockRejectedValueOnce({
      kind: "postgresError",
      message: "permission denied",
    });
    const policy = await loadCompressionPolicy("conn-1", "public", "metrics");
    expect(policy).toBeNull();
  });
});

describe("loadRetentionPolicy", () => {
  it("parses drop_after from the config JSON", async () => {
    queryExecuteMock.mockResolvedValueOnce(      jobsResult([["2002", JSON.stringify({ drop_after: "30 days" }), "1 day"]]),
);
    const policy = await loadRetentionPolicy("conn-1", "public", "metrics");
    expect(policy).toEqual({ jobId: 2002, dropAfter: "30 days" });

    const sql = queryExecuteMock.mock.calls[0]?.[1] as string;
    expect(sql).toContain("policy_retention");
  });

  it("returns null when no rows match", async () => {
    queryExecuteMock.mockResolvedValueOnce(jobsResult([]));
    expect(await loadRetentionPolicy("conn-1", "public", "metrics")).toBeNull();
  });
});

describe("loadRefreshPolicy", () => {
  it("parses start_offset / end_offset from config and schedule_interval from its column", async () => {
    queryExecuteMock.mockResolvedValueOnce(      jobsResult([
        ["3003", JSON.stringify({ start_offset: "30 days", end_offset: "1 hour" }), "1 hour"],
      ]),
);
    const policy = await loadRefreshPolicy("conn-1", "public", "hourly_metrics");
    expect(policy).toEqual({
      jobId: 3003,
      startOffset: "30 days",
      endOffset: "1 hour",
      scheduleInterval: "1 hour",
    });

    const sql = queryExecuteMock.mock.calls[0]?.[1] as string;
    expect(sql).toContain("policy_refresh_continuous_aggregate");
    expect(sql).toContain("hypertable_name = 'hourly_metrics'");
  });

  it("strips '@ ' from each interval-shaped field independently", async () => {
    queryExecuteMock.mockResolvedValueOnce(      jobsResult([
        ["4", JSON.stringify({ start_offset: "@ 30 days", end_offset: "@ 1 hour" }), "@ 1 hour"],
      ]),
);
    const policy = await loadRefreshPolicy("conn-1", "public", "hourly");
    expect(policy).toEqual({
      jobId: 4,
      startOffset: "30 days",
      endOffset: "1 hour",
      scheduleInterval: "1 hour",
    });
  });

  it("returns null on permission denied", async () => {
    queryExecuteMock.mockRejectedValueOnce({
      kind: "postgresError",
      message: "permission denied",
    });
    expect(await loadRefreshPolicy("conn-1", "public", "hourly")).toBeNull();
  });
});
