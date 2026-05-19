// — Backup / Restore zustand store.
//
// Holds the schedule list cache, in-flight job state, and a single subscription
// to the `backup:progress` Tauri event. Components opt into a job by calling
// `subscribeJob(jobId)`, which spins up the listener (idempotent) and returns
// the slice keyed by jobId. `clearJob(jobId)` releases the slice. The listener
// is reference-counted so the last unsubscribe tears it down.

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { create } from "zustand";

import type {
  BackupOptions,
  BaseBackupOptions,
  ProgressEvent,
  RestoreOptions,
  ScheduleEntry,
} from "./types";

export type JobStatus = "idle" | "running" | "done" | "failed" | "cancelled";

export type JobState = {
  jobId: string;
  status: JobStatus;
  phase: string | null;
  detail: string | null;
  percent: number | null;
  exitCode: number | null;
  stderrTail: string;
  startedAt: number | null;
  finishedAt: number | null;
  /** Output path for backup/basebackup so the success banner can display it. */
  outputPath: string | null;
};

const newJob = (jobId: string): JobState => ({
  jobId,
  status: "idle",
  phase: null,
  detail: null,
  percent: null,
  exitCode: null,
  stderrTail: "",
  startedAt: null,
  finishedAt: null,
  outputPath: null,
});

type BackupState = {
  schedules: ScheduleEntry[];
  loaded: boolean;
  jobs: Record<string, JobState>;
  hydrate: () => Promise<void>;
  previewBackup: (opts: BackupOptions) => Promise<string[]>;
  previewRestore: (opts: RestoreOptions) => Promise<string[]>;
  previewBaseBackup: (opts: BaseBackupOptions) => Promise<string[]>;
  runBackup: (jobId: string, opts: BackupOptions) => Promise<void>;
  runRestore: (jobId: string, opts: RestoreOptions) => Promise<void>;
  runBaseBackup: (jobId: string, opts: BaseBackupOptions) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  upsertSchedule: (    id: string,
    label: string,
    cron: string,
    backup: BackupOptions,
) => Promise<ScheduleEntry>;
  removeSchedule: (id: string) => Promise<void>;
  installSchedule: (id: string) => Promise<void>;
  uninstallSchedule: (id: string) => Promise<void>;
  runScheduleNow: (id: string) => Promise<string>;
  previewCronLine: (id: string, cron: string, backup: BackupOptions) => Promise<string>;
  /** Reference-counted progress-event subscription. Returns an unsubscribe. */
  subscribeJob: (jobId: string) => () => void;
  /** Drop a job slice (e.g. when the wizard unmounts). */
  clearJob: (jobId: string) => void;
  /** Apply a single ProgressEvent to the store — exposed for tests. */
  applyProgress: (evt: ProgressEvent) => void;
};

let listenerHandle: UnlistenFn | null = null;
let subscriberCount = 0;
let bootstrapping: Promise<void> | null = null;

async function ensureListener(apply: (evt: ProgressEvent) => void): Promise<void> {
  if (listenerHandle) return;
  if (bootstrapping) return bootstrapping;
  bootstrapping = (async () => {
    listenerHandle = await listen<ProgressEvent>("backup:progress", (event) => {
      if (event.payload) apply(event.payload);
    });
  })();
  try {
    await bootstrapping;
  } finally {
    bootstrapping = null;
  }
}

export const useBackup = create<BackupState>((set, get) => ({
  schedules: [],
  loaded: false,
  jobs: {},

  hydrate: async () => {
    const schedules = await invoke<ScheduleEntry[]>("schedule_list");
    set({ schedules, loaded: true });
  },

  previewBackup: async (opts) => invoke<string[]>("backup_preview_command", { opts }),
  previewRestore: async (opts) => invoke<string[]>("restore_preview_command", { opts }),
  previewBaseBackup: async (opts) => invoke<string[]>("basebackup_preview_command", { opts }),

  runBackup: async (jobId, opts) => {
    set((s) => ({
      jobs: {
        ...s.jobs,
        [jobId]: {
          ...newJob(jobId),
          status: "running",
          startedAt: Date.now(),
          outputPath: opts.outputPath,
        },
      },
    }));
    try {
      await invoke<void>("backup_run", { jobId, opts });
    } catch (err) {
      set((s) => ({
        jobs: {
          ...s.jobs,
          [jobId]: {
            ...(s.jobs[jobId] ?? newJob(jobId)),
            status: "failed",
            stderrTail: err instanceof Error ? err.message : String(err),
            finishedAt: Date.now(),
          },
        },
      }));
      throw err;
    }
  },

  runRestore: async (jobId, opts) => {
    set((s) => ({
      jobs: {
        ...s.jobs,
        [jobId]: {
          ...newJob(jobId),
          status: "running",
          startedAt: Date.now(),
          outputPath: opts.sourcePath,
        },
      },
    }));
    try {
      await invoke<void>("restore_run", { jobId, opts });
    } catch (err) {
      set((s) => ({
        jobs: {
          ...s.jobs,
          [jobId]: {
            ...(s.jobs[jobId] ?? newJob(jobId)),
            status: "failed",
            stderrTail: err instanceof Error ? err.message : String(err),
            finishedAt: Date.now(),
          },
        },
      }));
      throw err;
    }
  },

  runBaseBackup: async (jobId, opts) => {
    set((s) => ({
      jobs: {
        ...s.jobs,
        [jobId]: {
          ...newJob(jobId),
          status: "running",
          startedAt: Date.now(),
          outputPath: opts.outputDir,
        },
      },
    }));
    try {
      await invoke<void>("basebackup_run", { jobId, opts });
    } catch (err) {
      set((s) => ({
        jobs: {
          ...s.jobs,
          [jobId]: {
            ...(s.jobs[jobId] ?? newJob(jobId)),
            status: "failed",
            stderrTail: err instanceof Error ? err.message : String(err),
            finishedAt: Date.now(),
          },
        },
      }));
      throw err;
    }
  },

  cancelJob: async (jobId) => {
    await invoke<void>("backup_cancel", { jobId });
    set((s) => {
      const cur = s.jobs[jobId];
      if (!cur) return s;
      return { jobs: { ...s.jobs, [jobId]: { ...cur, status: "cancelled" } } };
    });
  },

  upsertSchedule: async (id, label, cron, backup) => {
    const entry = await invoke<ScheduleEntry>("schedule_upsert", {
      id,
      label,
      cron,
      backup,
    });
    set((state) => {
      const next = state.schedules.filter((e) => e.id !== id);
      next.push(entry);
      next.sort((a, b) => a.label.localeCompare(b.label));
      return { schedules: next };
    });
    return entry;
  },

  removeSchedule: async (id) => {
    await invoke<void>("schedule_remove", { id });
    set((state) => ({ schedules: state.schedules.filter((e) => e.id !== id) }));
  },

  installSchedule: async (id) => {
    await invoke<void>("schedule_install", { id });
    set((s) => ({
      schedules: s.schedules.map((e) => (e.id === id ? { ...e, installed: true } : e)),
    }));
  },

  uninstallSchedule: async (id) => {
    await invoke<void>("schedule_uninstall", { id });
    set((s) => ({
      schedules: s.schedules.map((e) => (e.id === id ? { ...e, installed: false } : e)),
    }));
  },

  runScheduleNow: async (id) => invoke<string>("schedule_run_now", { id }),

  previewCronLine: async (id, cron, backup) =>
    invoke<string>("schedule_preview_cron_line", { id, cron, backup }),

  subscribeJob: (jobId) => {
    set((s) => (s.jobs[jobId] ? s : { jobs: { ...s.jobs, [jobId]: newJob(jobId) } }));
    subscriberCount += 1;
    void ensureListener(get().applyProgress);
    return () => {
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0 && listenerHandle) {
        const off = listenerHandle;
        listenerHandle = null;
        try {
          off();
        } catch {
          // best-effort
        }
      }
    };
  },

  clearJob: (jobId) =>
    set((s) => {
      if (!(jobId in s.jobs)) return s;
      const next = { ...s.jobs };
      delete next[jobId];
      return { jobs: next };
    }),

  applyProgress: (evt) =>
    set((s) => {
      const cur = s.jobs[evt.jobId];
      if (!cur) return s;
      if (evt.kind === "phase") {
        return {
          jobs: {
            ...s.jobs,
            [evt.jobId]: {
              ...cur,
              status: cur.status === "idle" ? "running" : cur.status,
              phase: evt.phase,
              detail: evt.detail ?? null,
            },
          },
        };
      }
      if (evt.kind === "percent") {
        return {
          jobs: {
            ...s.jobs,
            [evt.jobId]: {
              ...cur,
              percent: Math.max(0, Math.min(100, evt.value)),
            },
          },
        };
      }
      // done
      return {
        jobs: {
          ...s.jobs,
          [evt.jobId]: {
            ...cur,
            status: evt.success ? "done" : "failed",
            exitCode: evt.exitCode ?? null,
            stderrTail: evt.stderrTail,
            finishedAt: Date.now(),
            percent: evt.success ? 100 : cur.percent,
          },
        },
      };
    }),
}));

/** Test-only: reset module-level listener bookkeeping. */
export function __resetBackupListenerForTests(): void {
  listenerHandle = null;
  subscriberCount = 0;
  bootstrapping = null;
}
