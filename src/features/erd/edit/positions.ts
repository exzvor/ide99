// src/features/erd/edit/positions.ts
//
// — `useErdPositions` hook. Loads persisted ERD canvas table
// positions on mount via `erd_load_positions`, exposes a `setPosition`
// updater that debounces an `erd_save_positions` call, and a `reset`
// helper that clears the in-memory map and persists an empty array
// (used by the "Reset Layout" toolbar action).

import { useEffect, useRef, useState } from "react";

import { type NodePos, erdLoadPositions, erdSavePositions } from "../../../lib/tauri";

const SAVE_DEBOUNCE_MS = 500;

export interface PositionsApi {
  positions: Map<string, { x: number; y: number }>;
  setPosition(nodeId: string, x: number, y: number): void;
  reset(): Promise<void>;
}

export function useErdPositions(connId: string, schemasKey: string): PositionsApi {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<Map<string, { x: number; y: number }>>(positions);
  latestRef.current = positions;

  useEffect(() => {
    let cancelled = false;
    void erdLoadPositions(connId, schemasKey)
      .then((rows: NodePos[]) => {
        if (cancelled) return;
        const m = new Map<string, { x: number; y: number }>();
        for (const r of rows) m.set(r.nodeId, { x: r.x, y: r.y });
        setPositions(m);
      })
      .catch(() => {
        // Best-effort: load failures (no file yet, malformed JSON) leave
        // the empty initial map alone so the canvas falls back to dagre.
      });
    return () => {
      cancelled = true;
    };
  }, [connId, schemasKey]);

  const scheduleSave = (): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const rows: NodePos[] = [...latestRef.current.entries()].map(([nodeId, p]) => ({
        nodeId,
        x: p.x,
        y: p.y,
      }));
      void erdSavePositions(connId, schemasKey, rows);
    }, SAVE_DEBOUNCE_MS);
  };

  const setPosition = (nodeId: string, x: number, y: number): void => {
    setPositions((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { x, y });
      latestRef.current = next;
      return next;
    });
    scheduleSave();
  };

  const reset = async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setPositions(new Map());
    latestRef.current = new Map();
    await erdSavePositions(connId, schemasKey, []);
  };

  return { positions, setPosition, reset };
}
