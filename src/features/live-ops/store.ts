// — Live Ops zustand store. Holds a per-connection slice keyed by
// `connId`; each slice owns the active sub-tab, sub-tab data states, polling
// handles, and context-menu state. Polling is active-only (only the visible
// sub-tab fires IPC), and a side-channel subscription to `useHealthActions`
// triggers a fresh sessions snapshot whenever an S13 killPid action lands
// (so the killed pid drops out of the DAG immediately).

import { create } from "zustand";
import {
  type Environment,
  type LiveOpsResult,
  type ReplicationOverview,
  type Session,
  type SessionsMode,
  type SessionsSnapshot,
  type SlowSnapshot,
  type SlowSortBy,
  liveOpsReplication,
  liveOpsSessions,
  liveOpsSlow,
} from "../../lib/tauri";
import { useHealthActions } from "../health/actions/store";
import { type LiveOpsPrefs, clearPrefs, loadPrefs, savePrefs } from "./prefs";
import type { CardData, ContextMenuState, PerConnState, SessionsView, SubTab } from "./types";

interface State {
  byConn: Map<string, PerConnState>;
}

interface Actions {
  ensureConn(connId: string, env: Environment): void;
  setActiveSubTab(connId: string, sub: SubTab): void;
  setSessionsMode(connId: string, mode: SessionsMode): void;
  setSessionsView(connId: string, view: SessionsView): void;
  setSortBy(connId: string, sort: SlowSortBy): void;
  setShowEmpty(connId: string, show: boolean): void;
  setIntervalMs(connId: string, ms: number | null): void;
  refreshNow(connId: string): Promise<void>;
  startPolling(connId: string): void;
  stopPolling(connId: string): void;
  openContextMenu(connId: string, x: number, y: number, session: Session): void;
  closeContextMenu(connId: string): void;
  clearConn(connId: string): void;
}

export type LiveOpsStore = State & Actions;

function emptySlice(prefs: LiveOpsPrefs): PerConnState {
  return {
    activeSubTab: prefs.activeSubTab,
    sessions: {
      mode: prefs.sessions.mode,
      view: prefs.sessions.view,
      data: { status: "idle" },
      intervalMs: prefs.sessions.intervalMs,
    },
    slow: {
      sortBy: prefs.slow.sortBy,
      data: { status: "idle" },
      intervalMs: prefs.slow.intervalMs,
    },
    replication: {
      showEmpty: prefs.replication.showEmpty,
      data: { status: "idle" },
      intervalMs: prefs.replication.intervalMs,
    },
    pollHandle: null,
    contextMenu: { open: false, x: 0, y: 0, pid: 0, query: "" },
    killPidUnsub: null,
  };
}

function snapshotPrefs(slice: PerConnState): LiveOpsPrefs {
  return {
    schemaVersion: 1,
    activeSubTab: slice.activeSubTab,
    sessions: {
      mode: slice.sessions.mode,
      view: slice.sessions.view,
      intervalMs: slice.sessions.intervalMs,
    },
    slow: { sortBy: slice.slow.sortBy, intervalMs: slice.slow.intervalMs },
    replication: {
      showEmpty: slice.replication.showEmpty,
      intervalMs: slice.replication.intervalMs,
    },
  };
}

function persistAfter(connId: string): (slice: PerConnState) => void {
  return (slice) => {
    setTimeout(() => savePrefs(connId, snapshotPrefs(slice)), 0);
  };
}

function translateOk<T>(data: T): CardData<T> {
  return { status: "ready", data, fetchedAt: Date.now() };
}

function translateErr<T>(result: Extract<LiveOpsResult<T>, { ok: false }>): CardData<T> {
  switch (result.error.kind) {
    case "notConnected":
      return { status: "error", message: "not connected" };
    case "forbidden":
      return { status: "forbidden", requiredRole: result.error.requiredRole };
    case "unavailable":
      return {
        status: "unavailable",
        extension: result.error.extension,
        installSql: result.error.installSql,
      };
    case "queryFailed":
      return { status: "error", message: result.error.message };
  }
}

export const useLiveOps = create<LiveOpsStore>((set, get) => ({
  byConn: new Map(),

  ensureConn(connId, env) {
    const cur = get().byConn.get(connId);
    if (cur) return;
    const prefs = loadPrefs(connId, env);
    const slice = emptySlice(prefs);
    set((s) => {
      const m = new Map(s.byConn);
      m.set(connId, slice);
      return { byConn: m };
    });
  },

  setActiveSubTab(connId, sub) {
    get().stopPolling(connId);
    set((s) => {
      const slice = s.byConn.get(connId);
      if (!slice) return s;
      const m = new Map(s.byConn);
      const next: PerConnState = { ...slice, activeSubTab: sub };
      m.set(connId, next);
      persistAfter(connId)(next);
      return { byConn: m };
    });
    void get().refreshNow(connId);
    get().startPolling(connId);
  },

  setSessionsMode(connId, mode) {
    set((s) => {
      const slice = s.byConn.get(connId);
      if (!slice) return s;
      const m = new Map(s.byConn);
      const next: PerConnState = { ...slice, sessions: { ...slice.sessions, mode } };
      m.set(connId, next);
      persistAfter(connId)(next);
      return { byConn: m };
    });
    if (get().byConn.get(connId)?.activeSubTab === "sessions") {
      void get().refreshNow(connId);
    }
  },

  setSessionsView(connId, view) {
    set((s) => {
      const slice = s.byConn.get(connId);
      if (!slice) return s;
      const m = new Map(s.byConn);
      const next: PerConnState = { ...slice, sessions: { ...slice.sessions, view } };
      m.set(connId, next);
      persistAfter(connId)(next);
      return { byConn: m };
    });
  },

  setSortBy(connId, sort) {
    set((s) => {
      const slice = s.byConn.get(connId);
      if (!slice) return s;
      const m = new Map(s.byConn);
      const next: PerConnState = { ...slice, slow: { ...slice.slow, sortBy: sort } };
      m.set(connId, next);
      persistAfter(connId)(next);
      return { byConn: m };
    });
    if (get().byConn.get(connId)?.activeSubTab === "slow") {
      void get().refreshNow(connId);
    }
  },

  setShowEmpty(connId, show) {
    set((s) => {
      const slice = s.byConn.get(connId);
      if (!slice) return s;
      const m = new Map(s.byConn);
      const next: PerConnState = {
        ...slice,
        replication: { ...slice.replication, showEmpty: show },
      };
      m.set(connId, next);
      persistAfter(connId)(next);
      return { byConn: m };
    });
  },

  setIntervalMs(connId, ms) {
    get().stopPolling(connId);
    set((s) => {
      const slice = s.byConn.get(connId);
      if (!slice) return s;
      const m = new Map(s.byConn);
      const sub = slice.activeSubTab;
      const next: PerConnState = {
        ...slice,
        [sub]: { ...slice[sub], intervalMs: ms },
      } as PerConnState;
      m.set(connId, next);
      persistAfter(connId)(next);
      return { byConn: m };
    });
    // The killPid subscription always lives in startPolling, even when
    // intervalMs === null, so the cross-refresh hook keeps working in Off mode.
    get().startPolling(connId);
  },

  async refreshNow(connId) {
    const slice = get().byConn.get(connId);
    if (!slice) return;
    const sub = slice.activeSubTab;
    set((s) => {
      const cur = s.byConn.get(connId);
      if (!cur) return s;
      const m = new Map(s.byConn);
      const next: PerConnState =
        sub === "sessions"
          ? { ...cur, sessions: { ...cur.sessions, data: { status: "loading" } } }
          : sub === "slow"
            ? { ...cur, slow: { ...cur.slow, data: { status: "loading" } } }
            : { ...cur, replication: { ...cur.replication, data: { status: "loading" } } };
      m.set(connId, next);
      return { byConn: m };
    });
    if (sub === "sessions") {
      const r = await liveOpsSessions(connId, slice.sessions.mode);
      set((s) => {
        const cur = s.byConn.get(connId);
        if (!cur) return s;
        const m = new Map(s.byConn);
        const data: CardData<SessionsSnapshot> = r.ok ? translateOk(r.data) : translateErr(r);
        m.set(connId, { ...cur, sessions: { ...cur.sessions, data } });
        return { byConn: m };
      });
    } else if (sub === "slow") {
      const r = await liveOpsSlow(connId, slice.slow.sortBy);
      set((s) => {
        const cur = s.byConn.get(connId);
        if (!cur) return s;
        const m = new Map(s.byConn);
        const data: CardData<SlowSnapshot> = r.ok ? translateOk(r.data) : translateErr(r);
        m.set(connId, { ...cur, slow: { ...cur.slow, data } });
        return { byConn: m };
      });
    } else {
      const r = await liveOpsReplication(connId);
      set((s) => {
        const cur = s.byConn.get(connId);
        if (!cur) return s;
        const m = new Map(s.byConn);
        const data: CardData<ReplicationOverview> = r.ok ? translateOk(r.data) : translateErr(r);
        m.set(connId, { ...cur, replication: { ...cur.replication, data } });
        return { byConn: m };
      });
    }
  },

  startPolling(connId) {
    const slice = get().byConn.get(connId);
    if (!slice || slice.pollHandle !== null || slice.killPidUnsub !== null) return;
    const sub = slice.activeSubTab;
    const ms = slice[sub].intervalMs;
    let handle: number | null = null;
    if (ms !== null) {
      handle = window.setInterval(() => {
        void get().refreshNow(connId);
      }, ms);
    }
    // Cross-refresh: when an S13 killPid action completes (running → idle),
    // force a fresh sessions snapshot so the killed pid drops out of the
    // DAG immediately.
    let prevPhase = useHealthActions.getState().phase;
    const killPidUnsub = useHealthActions.subscribe((state) => {
      const cur = state.phase;
      const prev = prevPhase;
      prevPhase = cur;
      const wasRunningKill = prev.kind === "running" && prev.target.kind === "killPid";
      const nowIdle = cur.kind === "idle";
      if (wasRunningKill && nowIdle) {
        void get().refreshNow(connId);
      }
    });
    set((s) => {
      const cur = s.byConn.get(connId);
      if (!cur) {
        // slice vanished mid-flight — undo the side-effects we created.
        if (handle !== null) window.clearInterval(handle);
        killPidUnsub();
        return s;
      }
      const m = new Map(s.byConn);
      m.set(connId, { ...cur, pollHandle: handle, killPidUnsub });
      return { byConn: m };
    });
  },

  stopPolling(connId) {
    const slice = get().byConn.get(connId);
    if (!slice) return;
    if (slice.pollHandle === null && slice.killPidUnsub === null) return;
    if (slice.pollHandle !== null) window.clearInterval(slice.pollHandle);
    if (slice.killPidUnsub) slice.killPidUnsub();
    set((s) => {
      const cur = s.byConn.get(connId);
      if (!cur) return s;
      const m = new Map(s.byConn);
      m.set(connId, { ...cur, pollHandle: null, killPidUnsub: null });
      return { byConn: m };
    });
  },

  openContextMenu(connId, x, y, session) {
    set((s) => {
      const cur = s.byConn.get(connId);
      if (!cur) return s;
      const m = new Map(s.byConn);
      const cm: ContextMenuState = {
        open: true,
        x,
        y,
        pid: session.pid,
        query: session.query,
      };
      m.set(connId, { ...cur, contextMenu: cm });
      return { byConn: m };
    });
  },

  closeContextMenu(connId) {
    set((s) => {
      const cur = s.byConn.get(connId);
      if (!cur) return s;
      const m = new Map(s.byConn);
      m.set(connId, {
        ...cur,
        contextMenu: { open: false, x: 0, y: 0, pid: 0, query: "" },
      });
      return { byConn: m };
    });
  },

  clearConn(connId) {
    get().stopPolling(connId);
    set((s) => {
      const m = new Map(s.byConn);
      m.delete(connId);
      return { byConn: m };
    });
    clearPrefs(connId);
  },
}));

export type { Session } from "../../lib/tauri";
