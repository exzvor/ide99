// — zustand sub-store: hypertables-per-connection registry.
// Mirrors useSchema / useErdStore patterns. Exposes a Map keyed by connId
// whose value is itself a Map keyed by "schema/name" → metadata.
//
// Hypertable registry consumers (SchemaTree badge, TimescaleTablePanel)
// subscribe via selectors and re-render reactively when hypertableRegistry's
// loadHypertables / invalidateHypertableCache mutate this map.
import { create } from "zustand";

export type HypertableRecord = {
  isHypertable: true;
  isContinuousAggregate: boolean;
};

export type HypertableMap = Map<string /*"schema/name"*/, HypertableRecord>;

export interface TimescaleState {
  hypertables: Map<string /*connId*/, HypertableMap>;
  setHypertables(connId: string, map: HypertableMap): void;
  clear(connId?: string): void;
}

export const useTimescale = create<TimescaleState>((set) => ({
  hypertables: new Map(),
  setHypertables: (connId, map) =>
    set((state) => {
      const next = new Map(state.hypertables);
      next.set(connId, map);
      return { hypertables: next };
    }),
  clear: (connId) =>
    set((state) => {
      if (connId === undefined) return { hypertables: new Map() };
      const next = new Map(state.hypertables);
      next.delete(connId);
      return { hypertables: next };
    }),
}));
