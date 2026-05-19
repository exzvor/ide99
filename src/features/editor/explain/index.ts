// — EXPLAIN visualizer feature barrel.
// Re-exports the public surface so consumers (EditorPane, EditorTabs)
// import from one path. Internal modules (ExplainToolbar, ExplainErrorView,
// ExplainEmpty, Pev2Bridge) stay private to this folder.

export { ExplainPane } from "./ExplainPane";
export { buildExplainSql } from "./buildSql";
// — diff + insights surface.
export { InsightsPanel } from "./InsightsPanel";
export { RecentPlansPickerModal } from "./RecentPlansPickerModal";
export { PlanDiffPane } from "./diff/PlanDiffPane";
