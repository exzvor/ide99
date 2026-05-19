/**
 * — Local form state for the JSONB Query Builder.
 *
 * Uses `useReducer` because operator/path changes have clear discrete events
 * that should wipe value (e.g. changing operator from containment to existence
 * clears the typed value; picking a new path with a different leaf type
 * resets the form value).
 */

import type { Comparator, PathSegment } from "../../../lib/tauri";
import type { BuilderValue } from "./sqlGenerator";

// Local re-exports so consumers don't need to import from sqlGenerator
export type { BuilderValue };

// Local properly-typed ExtractMode (tauri version uses BuilderValue = unknown)
type ExtractMode = { kind: "projection" } | { kind: "comparison"; eqValue: BuilderValue };

// Local BuilderOp (used for deriveOp output)
type BuilderOp =
  | { kind: "existence" }
  | { kind: "containment" }
  | { kind: "pathExtract"; mode: ExtractMode }
  | { kind: "pathPredicate"; comparator: Comparator; rhs: BuilderValue };

// ─────────────────────────────────────────────────────────────────────────────
// State shape
// ─────────────────────────────────────────────────────────────────────────────

export type OpKind = BuilderOp["kind"];

export interface BuilderFormState {
  /** Which operator is selected. */
  opKind: OpKind;
  /** Active path from the schema picker. */
  selectedPath: PathSegment[];
  /** The top-level value (used by Existence, Containment). */
  value: BuilderValue;
  /**
   * For PathExtract: projection vs comparison mode + comparison value.
   * Stored here so switching back/forth preserves the user's input.
   */
  extractMode: ExtractMode;
  /**
   * For PathPredicate: comparator + rhs value.
   */
  predicateComparator: Comparator;
  predicateRhs: BuilderValue;
  /**
   * For PathExtract comparison mode value — stored separately so it
   * isn't clobbered by top-level `value`.
   */
  extractComparisonValue: BuilderValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

export type BuilderAction =
  | { type: "SET_OP"; opKind: OpKind }
  | { type: "SET_PATH"; path: PathSegment[] }
  | { type: "SET_VALUE"; value: BuilderValue }
  | { type: "SET_EXTRACT_MODE"; mode: "projection" | "comparison" }
  | { type: "SET_EXTRACT_COMPARISON_VALUE"; value: BuilderValue }
  | { type: "SET_PREDICATE_COMPARATOR"; comparator: Comparator }
  | { type: "SET_PREDICATE_RHS"; value: BuilderValue };

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

const NONE_VALUE: BuilderValue = { kind: "none" };

export function initialState(): BuilderFormState {
  return {
    opKind: "existence",
    selectedPath: [],
    value: NONE_VALUE,
    extractMode: { kind: "projection" },
    predicateComparator: "eq",
    predicateRhs: NONE_VALUE,
    extractComparisonValue: NONE_VALUE,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────────────────────────────────────

export function builderReducer(state: BuilderFormState, action: BuilderAction): BuilderFormState {
  switch (action.type) {
    case "SET_OP":
      // Changing operator resets value inputs so the user starts fresh.
      return {
        ...state,
        opKind: action.opKind,
        value: NONE_VALUE,
        extractComparisonValue: NONE_VALUE,
        predicateRhs: NONE_VALUE,
      };

    case "SET_PATH": {
      // Changing path resets value (leaf type may differ).
      // For existence operator, default the key value to the last Key
      // segment of the path so the field is prefilled from the tree selection.
      let newValue: BuilderValue = NONE_VALUE;
      if (state.opKind === "existence" && action.path.length > 0) {
        for (let i = action.path.length - 1; i >= 0; i--) {
          const seg = action.path[i];
          if (seg && seg !== "arraywildcard") {
            newValue = { kind: "string", value: seg.key };
            break;
          }
        }
      }
      return {
        ...state,
        selectedPath: action.path,
        value: newValue,
        extractComparisonValue: NONE_VALUE,
        predicateRhs: NONE_VALUE,
      };
    }

    case "SET_VALUE":
      return { ...state, value: action.value };

    case "SET_EXTRACT_MODE":
      return {
        ...state,
        extractMode:
          action.mode === "projection"
            ? { kind: "projection" }
            : {
                kind: "comparison",
                eqValue: state.extractComparisonValue,
              },
      };

    case "SET_EXTRACT_COMPARISON_VALUE":
      return {
        ...state,
        extractComparisonValue: action.value,
        extractMode:
          state.extractMode.kind === "comparison"
            ? { kind: "comparison", eqValue: action.value }
            : state.extractMode,
      };

    case "SET_PREDICATE_COMPARATOR":
      return { ...state, predicateComparator: action.comparator };

    case "SET_PREDICATE_RHS":
      return { ...state, predicateRhs: action.value };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Derive BuilderOp from form state
// ─────────────────────────────────────────────────────────────────────────────

export function deriveOp(state: BuilderFormState): BuilderOp {
  switch (state.opKind) {
    case "existence":
      return { kind: "existence" };
    case "containment":
      return { kind: "containment" };
    case "pathExtract":
      return { kind: "pathExtract", mode: state.extractMode };
    case "pathPredicate":
      return {
        kind: "pathPredicate",
        comparator: state.predicateComparator,
        rhs: state.predicateRhs,
      };
  }
}
