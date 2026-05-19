// Privacy / app-settings DTOs — mirror src-tauri/src/telemetry/types.rs.

export type TelemetryEndpoint = "eu" | "ru" | "none";

/// — release channel for the auto-updater. Drives the manifest
/// URL `https://updates.ide99.io/<channel>/manifest.json`.
export type ReleaseChannel = "stable" | "beta" | "nightly";

export type AppSettings = {
  telemetryEnabled: boolean;
  crashReportsEnabled: boolean;
  telemetryEndpoint: TelemetryEndpoint;
  deviceUuid: string | null;
  onboardingCompleted: boolean;
  privacyChoiceMade: boolean;
  privacyChoiceMadeAt: string | null;
  /// — `stable | beta | nightly`. Default `stable`.
  releaseChannel: ReleaseChannel;
  /// — RFC3339 timestamp of the last `updater_check`.
  lastUpdateCheckAt: string | null;
  /// — paid-module subscription flags (default OFF).
  spg99Subscribed: boolean;
  vibepgSubscribed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CrashReport = {
  message: string;
  stack: string;
  platform: string;
  appVersion: string;
  capturedAt: string;
};

export type TelemetryError = {
  code: "storage_error" | "not_opted_in" | "unknown_event" | "invalid_input" | "network_error";
  message: string;
};
