/**
 * — 
 *
 * Public surface of the migrations feature. Phase E imports
 * `MigrationsPanel` from here and wires it into the Workspace tab
 * router; nothing else outside this directory needs to know about the
 * dialogs / dropdowns / Timeline internals.
 */

export { MigrationsPanel } from "./MigrationsPanel";
export { useMigrationsStore } from "./store";
export type { Migration, MigrationStatus } from "./store";
