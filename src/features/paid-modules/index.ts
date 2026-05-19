// Paid module UI hooks.
//
// ide99 stays fully functional without paid modules. Slot components render
// either the real action (with subscription) or an "Upgrade" button that
// opens the upgrade page.
//
// Currently reserved slots:
//   - Spg99* — Instant DB (on-demand throwaway PostgreSQL). Free beta.
//   - Vibepg* — reserved for an upcoming AI-agent module. UI scaffolding
//     only; backend wiring is a future release.

export { usePaidModules } from "./store";
export { UpgradeBanner } from "./UpgradeBanner";
export { Spg99InstantDbButton } from "./Spg99InstantDbButton";
export { VibepgActionButton } from "./VibepgActionButton";
export type { VibepgSlot } from "./VibepgActionButton";
export { VibepgResultDialog } from "./VibepgResultDialog";
export type { VibepgResultPreview } from "./VibepgResultDialog";
export { VibepgAgentModeToggle } from "./VibepgAgentModeToggle";
export type { AiMode } from "./VibepgAgentModeToggle";
export {
  VibepgCommandPalette,
  VIBEPG_COMMANDS,
} from "./VibepgCommandPalette";
export type { VibepgCommandId } from "./VibepgCommandPalette";
export { sendUpgradeClickTelemetry } from "./telemetry";
export { Spg99StatusBarWidget } from "./Spg99StatusBarWidget";
export { ModulesSettingsPanel } from "./ModulesSettingsPanel";
export { Spg99TemplatePickerDialog } from "./Spg99TemplatePickerDialog";
export type {
  Spg99TemplateKind,
  TemplatePickerOpenDetail,
} from "./Spg99TemplatePickerDialog";
export { ReproduceOnDisposableButton } from "./ReproduceOnDisposableButton";
export { Spg99DryRunTargetPicker } from "./Spg99DryRunTargetPicker";
export type { DryRunTarget } from "./Spg99DryRunTargetPicker";
export type {
  ModuleId,
  SubscriptionState,
  ActionPreflight,
  ModuleError,
} from "./types";
