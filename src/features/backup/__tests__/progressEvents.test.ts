/**
 * — exercises the progress-event accumulator inside the backup
 * store. The store's `applyProgress` is the pure reducer, so we drive it
 * directly without spinning up a Tauri listener.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type Listener = (event: { payload: unknown }) => void;
const listenerBuckets = new Map<string, Set<Listener>>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, cb: Listener) => {
    let bucket = listenerBuckets.get(eventName);
    if (!bucket) {
      bucket = new Set();
      listenerBuckets.set(eventName, bucket);
    }
    bucket.add(cb);
    return () => {
      bucket?.delete(cb);
    };
  }),
}));

import { __resetBackupListenerForTests, useBackup } from "../store";

const initial = useBackup.getState();
beforeEach(() => {
  invokeMock.mockReset();
  listenerBuckets.clear();
  __resetBackupListenerForTests();
  useBackup.setState({ ...initial, jobs: {}, schedules: [], loaded: false });
});

afterEach(() => vi.clearAllMocks());

describe("progress event accumulator", () => {
  it("phase events transition idle → running and store phase + detail", () => {
    useBackup.setState({
      jobs: {
        j1: {
          jobId: "j1",
          status: "idle",
          phase: null,
          detail: null,
          percent: null,
          exitCode: null,
          stderrTail: "",
          startedAt: null,
          finishedAt: null,
          outputPath: null,
        },
      },
    });
    useBackup
      .getState()
      .applyProgress({ kind: "phase", jobId: "j1", phase: "dumping", detail: "public.users" });
    const j = useBackup.getState().jobs.j1;
    expect(j.status).toBe("running");
    expect(j.phase).toBe("dumping");
    expect(j.detail).toBe("public.users");
  });

  it("percent events clamp to [0..100]", () => {
    useBackup.setState({
      jobs: {
        j1: {
          jobId: "j1",
          status: "running",
          phase: "dumping",
          detail: null,
          percent: 0,
          exitCode: null,
          stderrTail: "",
          startedAt: 0,
          finishedAt: null,
          outputPath: null,
        },
      },
    });
    useBackup.getState().applyProgress({ kind: "percent", jobId: "j1", value: 200 });
    expect(useBackup.getState().jobs.j1.percent).toBe(100);
    useBackup.getState().applyProgress({ kind: "percent", jobId: "j1", value: -5 });
    expect(useBackup.getState().jobs.j1.percent).toBe(0);
    useBackup.getState().applyProgress({ kind: "percent", jobId: "j1", value: 42 });
    expect(useBackup.getState().jobs.j1.percent).toBe(42);
  });

  it("done(success=true) marks status=done and snaps percent to 100", () => {
    useBackup.setState({
      jobs: {
        j1: {
          jobId: "j1",
          status: "running",
          phase: "dumping",
          detail: null,
          percent: 80,
          exitCode: null,
          stderrTail: "",
          startedAt: 0,
          finishedAt: null,
          outputPath: "/tmp/out.dump",
        },
      },
    });
    useBackup.getState().applyProgress({
      kind: "done",
      jobId: "j1",
      success: true,
      exitCode: 0,
      stderrTail: "",
    });
    const j = useBackup.getState().jobs.j1;
    expect(j.status).toBe("done");
    expect(j.percent).toBe(100);
    expect(j.exitCode).toBe(0);
    expect(j.outputPath).toBe("/tmp/out.dump");
  });

  it("done(success=false) marks status=failed and keeps stderr tail", () => {
    useBackup.setState({
      jobs: {
        j1: {
          jobId: "j1",
          status: "running",
          phase: "dumping",
          detail: null,
          percent: 50,
          exitCode: null,
          stderrTail: "",
          startedAt: 0,
          finishedAt: null,
          outputPath: null,
        },
      },
    });
    useBackup.getState().applyProgress({
      kind: "done",
      jobId: "j1",
      success: false,
      exitCode: 1,
      stderrTail: "pg_dump: connection refused",
    });
    const j = useBackup.getState().jobs.j1;
    expect(j.status).toBe("failed");
    expect(j.exitCode).toBe(1);
    expect(j.stderrTail).toContain("connection refused");
    // percent NOT auto-snapped on failure
    expect(j.percent).toBe(50);
  });

  it("ignores events for unknown jobIds (no slice creation)", () => {
    useBackup.getState().applyProgress({
      kind: "phase",
      jobId: "ghost",
      phase: "dumping",
    });
    expect(useBackup.getState().jobs.ghost).toBeUndefined();
  });

  it("subscribeJob is reference-counted and registers a single listener", async () => {
    const off1 = useBackup.getState().subscribeJob("j1");
    const off2 = useBackup.getState().subscribeJob("j2");
    // Tauri listen() is async — wait a microtask so ensureListener resolves.
    await Promise.resolve();
    await Promise.resolve();
    const bucket = listenerBuckets.get("backup:progress");
    expect(bucket?.size).toBe(1);
    off1();
    expect(listenerBuckets.get("backup:progress")?.size).toBe(1);
    off2();
    expect(listenerBuckets.get("backup:progress")?.size ?? 0).toBe(0);
  });
});
