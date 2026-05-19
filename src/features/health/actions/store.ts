import { create } from "zustand";
import type { ToastApi } from "../../../components/Toast";
import {
  type ActionResultWire,
  type Connection,
  healthActionAnalyze,
  healthActionCheckPid,
  healthActionDropIndex,
  healthActionKillPid,
  healthActionProgress,
  healthActionReindexTable,
  healthActionVacuum,
  onHealthActionStarted,
} from "../../../lib/tauri";
import { useEditor } from "../../editor/store";
import { useHealth } from "../store";
import { ACTION_REFRESH } from "./refreshMap";
import type { ActionTarget, ProgressSnapshot } from "./types";

export type ActionPhase =
  | { kind: "idle" }
  | { kind: "preview"; target: ActionTarget; conn: Connection }
  | {
      kind: "running";
      target: ActionTarget;
      conn: Connection;
      actionId: string | null;
      pid: number | null;
      progress: ProgressSnapshot | null;
    }
  | { kind: "kill_fallback"; conn: Connection; pid: number };

export interface HealthActionsState {
  phase: ActionPhase;
  openPreview(target: ActionTarget, conn: Connection): void;
  cancel(): void;
  /** `toast` passed by the caller (a React component using `useToast()`) so
   * the store stays free of React-hook side-effects. */
  runAction(toast: ToastApi): Promise<void>;
  abortLongRunning(toast: ToastApi): Promise<void>;
  confirmTerminate(toast: ToastApi): Promise<void>;
}

export const useHealthActions = create<HealthActionsState>((set, _get) => ({
  phase: { kind: "idle" },
  openPreview(target, conn) {
    set({ phase: { kind: "preview", target, conn } });
  },
  cancel() {
    set({ phase: { kind: "idle" } });
  },
  async runAction(toast) {
    const phase = _get().phase;
    if (phase.kind !== "preview") return;
    const { target, conn } = phase;

    if (target.kind === "explain") {
      // EXPLAIN bypasses the backend entirely — open a fresh editor tab
      // seeded with the slow query and let the user run EXPLAIN from there.
      try {
        useEditor.getState().openEditorTab(conn.id, { prefillSql: target.sql });
      } catch {
        // If the host editor store isn't available (test env) — silently
        // fall through; toast is best-effort.
      }
      set({ phase: { kind: "idle" } });
      return;
    }

    // Subscribe to "started" event before invoke.
    let unlisten: (() => void) | null = null;
    let pollHandle: number | null = null;
    let actionId: string | null = null;
    let pid: number | null = null;

    set({
      phase: {
        kind: "running",
        target,
        conn,
        actionId: null,
        pid: null,
        progress: null,
      },
    });

    try {
      unlisten = await onHealthActionStarted((p) => {
        actionId = p.actionId;
        pid = p.pid;
        set((s) => {
          if (s.phase.kind !== "running") return s;
          return {
            phase: { ...s.phase, actionId, pid },
          };
        });
        // Begin polling once we know the actionId.
        if (pollHandle === null && (target.kind === "vacuum" || target.kind === "reindexTable")) {
          pollHandle = window.setInterval(async () => {
            if (actionId === null) return;
            try {
              const snap = await healthActionProgress(conn.id, actionId);
              set((s) => {
                if (s.phase.kind !== "running") return s;
                return { phase: { ...s.phase, progress: snap } };
              });
            } catch {
              // Polling errors are silent — the main invoke is the
              // authoritative finish signal.
            }
          }, 500);
        }
      });

      const dispatch: Record<
        Exclude<ActionTarget, { kind: "explain" }>["kind"],
        (t: ActionTarget) => Promise<ActionResultWire>
      > = {
        reindexTable: (t) =>
          healthActionReindexTable(
            conn.id,
            (t as { schema: string }).schema,
            (t as { table: string }).table,
          ),
        vacuum: (t) =>
          healthActionVacuum(
            conn.id,
            (t as { schema: string }).schema,
            (t as { table: string }).table,
          ),
        analyze: (t) =>
          healthActionAnalyze(
            conn.id,
            (t as { schema: string }).schema,
            (t as { table: string }).table,
          ),
        dropIndex: (t) =>
          healthActionDropIndex(
            conn.id,
            (t as { schema: string }).schema,
            (t as { index: string }).index,
          ),
        killPid: (t) =>
          healthActionKillPid(
            conn.id,
            (t as { pid: number }).pid,
            (t as { terminate?: boolean }).terminate ?? false,
          ),
      };

      const result = await dispatch[target.kind as keyof typeof dispatch](target);

      // Handle kill PID NotFound and prompt-for-terminate fallback.
      if (target.kind === "killPid" && result.status === "notFound") {
        toast.info(`Session ${(target as { pid: number }).pid} already finished.`);
      } else if (
        target.kind === "killPid" &&
        result.status === "completed" &&
        !(target as { terminate?: boolean }).terminate
      ) {
        // Cancel succeeded — verify the session actually died after ~1.5s.
        await new Promise((r) => setTimeout(r, 1500));
        const stillAlive = await healthActionCheckPid(
          conn.id,
          (target as { pid: number }).pid,
        ).catch(() => false);
        if (stillAlive) {
          set({
            phase: {
              kind: "kill_fallback",
              conn,
              pid: (target as { pid: number }).pid,
            },
          });
          return; // skip refreshMap + idle until user confirms
        }
        toast.success(`Session ${(target as { pid: number }).pid} cancelled.`);
      } else {
        toast.success(`Action completed in ${result.durationMs} ms.`);
      }

      // Cross-card refresh.
      const cards = ACTION_REFRESH[target.kind];
      for (const cardId of cards) {
        useHealth.getState().refreshOne(conn.id, cardId);
      }

      set({ phase: { kind: "idle" } });
    } catch (e) {
      const message =
        typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
      // — surface "Explain in plain English" inline in the toast.
      // We import lazily to keep this store independent of the React layer.
      const userMessage = `Action failed: ${message}`;
      try {
        const [{ openErrorExplain }, i18n] = await Promise.all([
          import("../../error-explain/ErrorExplainModal"),
          import("../../../i18n"),
        ]);
        const t = i18n.default.t.bind(i18n.default);
        toast.errorWithAction(userMessage, {
          label: t("errorExplain.button"),
          onClick: () => openErrorExplain({ message }),
        });
      } catch {
        toast.error(userMessage);
      }
      set({ phase: { kind: "idle" } });
    } finally {
      if (pollHandle !== null) {
        window.clearInterval(pollHandle);
        pollHandle = null;
      }
      if (unlisten) {
        try {
          unlisten();
        } catch {
          /* listener already gone */
        }
      }
    }
  },
  async abortLongRunning(toast) {
    const phase = _get().phase;
    if (phase.kind !== "running" || phase.pid === null) return;
    try {
      await healthActionKillPid(phase.conn.id, phase.pid, false);
      toast.info("Cancelling…");
    } catch {
      // The main invoke will surface the resulting error; abort is best-effort.
    }
    // Don't change phase here — the main invoke's catch/finally is what
    // resets to idle when it actually returns.
  },
  async confirmTerminate(toast) {
    const phase = _get().phase;
    if (phase.kind !== "kill_fallback") return;
    try {
      await healthActionKillPid(phase.conn.id, phase.pid, true);
      toast.success(`Session ${phase.pid} terminated.`);
      for (const cardId of ACTION_REFRESH.killPid) {
        useHealth.getState().refreshOne(phase.conn.id, cardId);
      }
    } catch (e) {
      const message =
        typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
      toast.error(`Terminate failed: ${message}`);
    } finally {
      set({ phase: { kind: "idle" } });
    }
  },
}));
