// — zustand sub-store: pg_partman parents per connection.
// Mirrors useTimescale pattern .
import { create } from "zustand";

export type PartmanParent = {
  schema: string;
  table: string;
  controlColumn: string;
  intervalText: string;
  retentionText: string | null;
  premakeCount: number;
};

export type PartmanMap = Map<string /*"schema/table"*/, PartmanParent>;

export interface PgPartmanState {
  parents: Map<string /*connId*/, PartmanMap>;
  setParents(connId: string, map: PartmanMap): void;
  clear(connId?: string): void;
}

export const usePgPartman = create<PgPartmanState>((set) => ({
  parents: new Map(),
  setParents: (connId, map) =>
    set((state) => {
      const next = new Map(state.parents);
      next.set(connId, map);
      return { parents: next };
    }),
  clear: (connId) =>
    set((state) => {
      if (connId === undefined) return { parents: new Map() };
      const next = new Map(state.parents);
      next.delete(connId);
      return { parents: next };
    }),
}));
