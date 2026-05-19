/**
 * — 
 *
 * Public surface of the Squawk lint sub-module. Internal access from the
 * S21 migrations files (Timeline, ApplyDialog, MigrationsPanel) goes via
 * direct file imports; this barrel exists for clarity + future external
 * consumers (e.g., a dedicated migrations health card).
 */

export { EmptyStateInstall } from "./EmptyStateInstall";
export { findingsToMonacoMarkers } from "./lintMarkers";
export { useLintStore } from "./lintStore";
export type { SquawkFinding, SquawkSeverity } from "./lintStore";
