/**
 * — 
 *
 * Zustand sub-store for Squawk lint findings. Frontend-only: backend
 * commands (`lint_check_install`, `lint_list_rules`, `lint_file`) are
 * invoked from MigrationsPanel; the resolves populate this store, which
 * Timeline + ApplyDialog read from.
 */

import { create } from "zustand";

export type SquawkSeverity = "warning" | "error";

export type SquawkFinding = {
  rule: string;
  severity: SquawkSeverity;
  file: string;
  line: number;
  column: number;
  message: string;
};

interface State {
  installed: boolean | null; // null = unknown (not yet checked)
  version: string | null;
  ruleDescriptions: Map<string, string>;
  findingsByVersion: Map<string, SquawkFinding[]>;
}

interface Actions {
  setInstalled(installed: boolean, version: string | null): void;
  setRuleDescriptions(rules: Record<string, string>): void;
  setFindings(version: string, findings: SquawkFinding[]): void;
  clearFindings(version: string): void;
  clearAll(): void;
}

export type LintStore = State & Actions;

export const useLintStore = create<LintStore>((set) => ({
  installed: null,
  version: null,
  ruleDescriptions: new Map(),
  findingsByVersion: new Map(),

  setInstalled: (installed, version) => set({ installed, version }),

  setRuleDescriptions: (rules) => set({ ruleDescriptions: new Map(Object.entries(rules)) }),

  setFindings: (version, findings) =>
    set((s) => {
      const next = new Map(s.findingsByVersion);
      next.set(version, findings);
      return { findingsByVersion: next };
    }),

  clearFindings: (version) =>
    set((s) => {
      const next = new Map(s.findingsByVersion);
      next.delete(version);
      return { findingsByVersion: next };
    }),

  clearAll: () => set({ findingsByVersion: new Map() }),
}));
