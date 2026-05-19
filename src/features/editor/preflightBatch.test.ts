/**
 * Post-S14 — preflightBatch unit tests.
 *
 * Covers:
 * - pass-through (no destructive, writable conn)
 * - read-only fail-fast (offendingIndex points at the first write)
 * - consolidated batchConfirm modal for N>1 destructive runs
 * - cancellation through the consolidated modal
 * - N=1 destructive delegation to legacy preflightSafety (kind: "confirm")
 * - slow-query warning skipped for batches >1
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../lib/tauri";
import { preflightBatch } from "./preflightBatch";

const baseConn = (overrides?: Partial<Connection>): Connection =>
  ({
    id: "c1",
    name: "test",
    host: "h",
    port: 5432,
    database: "ide99_diag",
    username: "u",
    sslMode: "disable",
    hasPassword: false,
    createdAt: "",
    updatedAt: "",
    lastTestedAt: null,
    lastTestOk: null,
    excludeFromHistory: false,
    excludeFromRecentPlans: false,
    environment: "dev",
    readOnly: false,
    confirmDestructive: false,
    slowQueryWarning: false,
    ...overrides,
  }) as Connection;

afterEach(() => vi.clearAllMocks());

describe("preflightBatch", () => {
  it("passes through when no statement is destructive and conn is writable", async () => {
    const r = await preflightBatch(baseConn(), ["SELECT 1", "SELECT 2"], () => {});
    expect(r.outcome).toBe("ok");
  });

  it("blocks first write on read-only connection", async () => {
    const r = await preflightBatch(      baseConn({ readOnly: true }),
      ["SELECT 1", "INSERT INTO foo VALUES(1)", "SELECT 2"],
      () => {},
);
    expect(r.outcome).toBe("blocked");
    if (r.outcome === "blocked") {
      expect(r.offendingIndex).toBe(1);
    }
  });

  it("opens consolidated confirm modal once for batch >1 with destructive ops", async () => {
    const setSpy = vi.fn();
    setSpy.mockImplementation((p: { safetyModal?: { kind: string; onConfirm?: () => void } }) => {
      if (p.safetyModal?.kind === "batchConfirm") {
        (p.safetyModal as { onConfirm: () => void }).onConfirm();
      }
    });

    const r = await preflightBatch(      baseConn({ environment: "prod" }),
      ["SELECT 1", "DROP TABLE x", "TRUNCATE y"],
      setSpy,
);

    expect(setSpy).toHaveBeenCalledWith(      expect.objectContaining({
        safetyModal: expect.objectContaining({ kind: "batchConfirm" }),
      }),
);
    expect(r.outcome).toBe("ok");
  });

  it("returns cancelled when user dismisses the consolidated modal", async () => {
    const setSpy = vi.fn();
    setSpy.mockImplementation((p: { safetyModal?: { kind: string; onCancel?: () => void } }) => {
      if (p.safetyModal?.kind === "batchConfirm") {
        (p.safetyModal as { onCancel: () => void }).onCancel();
      }
    });

    // Use N>1 to hit the consolidated modal path (N=1 delegates to
    // legacy preflightSafety — see the next test).
    const r = await preflightBatch(      baseConn({ environment: "prod" }),
      ["DROP TABLE x", "DROP TABLE y"],
      setSpy,
);
    expect(r.outcome).toBe("cancelled");
  });

  it("falls back to single-statement preflightSafety when N=1 and destructive", async () => {
    // Single-statement path keeps the existing modal kind ("confirm"),
    // not the batch one.
    const setSpy = vi.fn();
    setSpy.mockImplementation((p: { safetyModal?: { kind: string; onConfirm?: () => void } }) => {
      if (p.safetyModal?.kind === "confirm") {
        (p.safetyModal as { onConfirm: () => void }).onConfirm();
      }
    });

    const r = await preflightBatch(baseConn({ environment: "prod" }), ["DROP TABLE x"], setSpy);
    expect(setSpy).toHaveBeenCalledWith(      expect.objectContaining({
        safetyModal: expect.objectContaining({ kind: "confirm" }),
      }),
);
    expect(r.outcome).toBe("ok");
  });

  it("skips slow-query warning for batches >1", async () => {
    const setSpy = vi.fn();
    const r = await preflightBatch(      baseConn({ slowQueryWarning: true }),
      ["SELECT * FROM huge_table_a", "SELECT * FROM huge_table_b"],
      setSpy,
);
    // No `slow` modal opened.
    expect(setSpy).not.toHaveBeenCalledWith(      expect.objectContaining({
        safetyModal: expect.objectContaining({ kind: "slow" }),
      }),
);
    expect(r.outcome).toBe("ok");
  });
});
