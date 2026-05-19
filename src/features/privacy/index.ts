// — Privacy Settings panel + first-run telemetry opt-in dialog
// + crash preview reporter.

export { PrivacyPanel } from "./PrivacyPanel";
export { TelemetryOptInDialog } from "./TelemetryOptInDialog";
export { WhatWeCollectDialog } from "./WhatWeCollectDialog";
export { CrashReportDialog } from "./CrashReportDialog";
export { CrashReporterHost } from "./CrashReporterHost";
export { useAppSettings } from "./store";
export type { AppSettings, TelemetryEndpoint, CrashReport } from "./types";
