// Paid-module DTOs — mirror src-tauri/src/modules/types.rs.

export type ModuleId = "spg99" | "vibepg";

export type SubscriptionState = {
  spg99Subscribed: boolean;
  vibepgSubscribed: boolean;
  upgradeUrlSpg99: string;
  upgradeUrlVibepg: string;
};

export type ActionPreflight = {
  module: ModuleId;
  allowed: boolean;
  upgradeUrl: string | null;
  reasonKey: string;
};

export type ModuleError = {
  code: "not_subscribed" | "storage_error" | "invalid_input";
  message: string;
};
