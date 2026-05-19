/**
 * — ERD payload cache (, task C1).
 *
 * A tiny per-key state machine over the `erdGetSchemaGraph` IPC. Keyed
 * by `${connId}|${schemasFilterKey}` so that re-opening the ERD tab or
 * toggling the schema filter back-and-forth does not re-issue the
 * round-trip.
 *
 * - State machine per key:
 * `idle | loading | ready | error`
 * - Cache key: `connId + "|" + sortedSchemas.join(",")`.
 * `undefined` schemas (= "all") collapses to the sentinel `*`.
 * - `loadGraph` is a no-op when an entry is already `ready`. While
 * `loading`, concurrent calls share the in-flight promise instead of
 * issuing a duplicate query.
 * - `invalidate(connId)` drops every key whose conn-prefix matches.
 * - The store does NOT localize error messages — components compose
 * `t("erd.error.title")` with the raw message at render time so this
 * module stays decoupled from i18n.
 */

import { useEffect, useState } from "react";
import { create } from "zustand";
import { type ErdSchemaGraph, erdGetSchemaGraph, schemaListSchemas } from "../../lib/tauri";

export type ErdLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; graph: ErdSchemaGraph }
  | { kind: "error"; message: string };

const IDLE: ErdLoadState = { kind: "idle" };
const LOADING: ErdLoadState = { kind: "loading" };

interface ErdStoreState {
  /** Cache keyed by `${connId}|${filterKey}`. */
  entries: Map<string, ErdLoadState>;
  /** In-flight promises keyed identically — collapses concurrent calls. */
  inFlight: Map<string, Promise<void>>;
  loadGraph(connId: string, schemas: string[] | undefined): Promise<void>;
  invalidate(connId: string): void;
  getState(connId: string, schemas: string[] | undefined): ErdLoadState;
}

/** Stable sentinel for "all schemas". */
function filterKey(schemas: string[] | undefined): string {
  if (schemas === undefined) return "*";
  // Copy before sort so the caller's array is not mutated.
  return [...schemas].sort().join(",");
}

function cacheKey(connId: string, schemas: string[] | undefined): string {
  return `${connId}|${filterKey(schemas)}`;
}

export const useErdStore = create<ErdStoreState>((set, get) => ({
  entries: new Map(),
  inFlight: new Map(),

  getState(connId, schemas) {
    return get().entries.get(cacheKey(connId, schemas)) ?? IDLE;
  },

  invalidate(connId) {
    const next = new Map(get().entries);
    const prefix = `${connId}|`;
    for (const key of [...next.keys()]) {
      if (key.startsWith(prefix)) next.delete(key);
    }
    const inFlight = new Map(get().inFlight);
    for (const key of [...inFlight.keys()]) {
      if (key.startsWith(prefix)) inFlight.delete(key);
    }
    set({ entries: next, inFlight });
  },

  async loadGraph(connId, schemas) {
    const key = cacheKey(connId, schemas);
    const current = get().entries.get(key) ?? IDLE;
    if (current.kind === "ready") return;
    const existingFlight = get().inFlight.get(key);
    if (existingFlight) return existingFlight;

    // Mark loading.
    {
      const next = new Map(get().entries);
      next.set(key, LOADING);
      set({ entries: next });
    }

    const promise = (async () => {
      try {
        const graph = await erdGetSchemaGraph(connId, schemas);
        const next = new Map(get().entries);
        next.set(key, { kind: "ready", graph });
        set({ entries: next });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const next = new Map(get().entries);
        next.set(key, { kind: "error", message });
        set({ entries: next });
      } finally {
        const flights = new Map(get().inFlight);
        flights.delete(key);
        set({ inFlight: flights });
      }
    })();

    const flights = new Map(get().inFlight);
    flights.set(key, promise);
    set({ inFlight: flights });

    await promise;
  },
}));

/**
 * React hook: subscribe to the cached state for `(connId, schemas)` and
 * (lazily) trigger a load on first mount or whenever the key changes.
 *
 * Returns `{ state, retry }`. Calling `retry()` re-issues the IPC by
 * clearing the entry and calling `loadGraph` again — useful for the
 * error branch's "Retry" button in `ErdPane`.
 */
export function useErdGraph(
  connId: string,
  schemas: string[] | undefined,
): { state: ErdLoadState; retry: () => void } {
  const key = cacheKey(connId, schemas);
  const state = useErdStore((s) => s.entries.get(key) ?? IDLE);

  useEffect(() => {
    if (state.kind === "idle") {
      void useErdStore.getState().loadGraph(connId, schemas);
    }
    // We deliberately depend on `key` (a derived string) rather than the
    // raw `schemas` array to avoid re-renders from referentially-fresh
    // `[...]` literals in callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state.kind]);

  const retry = (): void => {
    // Drop the existing entry and re-load.
    const entries = new Map(useErdStore.getState().entries);
    entries.delete(key);
    useErdStore.setState({ entries });
    void useErdStore.getState().loadGraph(connId, schemas);
  };

  return { state, retry };
}

/**
 * — list of ALL non-system schemas for the connection,
 * independent of the current schema filter. Used by the toolbar dropdown
 * so the user can switch from one schema to another without first
 * resetting to "All schemas" ().
 *
 * Calls the existing lightweight `schemaListSchemas` IPC. Cached locally
 * within the hook — every fresh `connId` triggers exactly one round-trip.
 */
const availableSchemasCache = new Map<string, string[]>();
const availableSchemasInFlight = new Map<string, Promise<void>>();

export function useErdAvailableSchemas(connId: string): string[] {
  const [list, setList] = useState<string[]>(() => availableSchemasCache.get(connId) ?? []);

  useEffect(() => {
    const cached = availableSchemasCache.get(connId);
    if (cached) {
      setList(cached);
      return;
    }
    let cancelled = false;
    let promise = availableSchemasInFlight.get(connId);
    if (!promise) {
      promise = (async () => {
        try {
          const schemas = await schemaListSchemas(connId);
          const names = schemas.map((s) => s.name).sort();
          availableSchemasCache.set(connId, names);
        } catch {
          /* swallow — toolbar will fall back to graph-derived list */
        } finally {
          availableSchemasInFlight.delete(connId);
        }
      })();
      availableSchemasInFlight.set(connId, promise);
    }
    void promise.then(() => {
      if (cancelled) return;
      const next = availableSchemasCache.get(connId);
      if (next) setList(next);
    });
    return () => {
      cancelled = true;
    };
  }, [connId]);

  return list;
}
