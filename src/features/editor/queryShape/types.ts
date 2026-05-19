// src/features/editor/queryShape/types.ts
//
// Re-exports the canonical SELECT shape types from `lib/parser` so the
// queryShape feature module has a single, stable import surface that the
// store + UI can depend on without reaching into the parser wrapper.
export type {
  QueryShape,
  Filter,
  FilterOp,
  Sort,
  SortDir,
  BaseSelect,
  ClauseSpan,
} from "../../../lib/parser";
