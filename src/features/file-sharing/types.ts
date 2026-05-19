// `.ide99` file-sharing DTOs — mirror src-tauri/src/file_sharing/types.rs.

export type ShareKind =
  | "connection"
  | "connection-bundle"
  | "snippet"
  | "snippet-bundle"
  | "query"
  | "notebook"
  | "migration-set"
  | "erd-layout"
  | "theme"
  | "keymap"
  | "health-config";

export type ShareEnvelope = {
  version: number;
  kind: ShareKind;
  exportedAt: string;
  payload: unknown;
};

export type ImportPreview = {
  kind: ShareKind;
  version: number;
  exportedAt: string;
  summary: string;
  mayCollide: boolean;
};

export type ShareError = {
  code: "invalid_file" | "unsupported_version" | "not_implemented" | "storage_error" | "io_error";
  message: string;
};

// Per-kind import shapes (mirror src-tauri/src/file_sharing/kinds/*.rs).

export type ExportedErdLayout = {
  label: string;
  schemasKey: string;
  positions: Array<{ nodeId: string; x: number; y: number }>;
};

export type ExportedTheme = {
  name: string;
  tokens: Record<string, unknown>;
};

export type ExportedKeymap = {
  name: string;
  bindings: unknown[];
};

export type ExportedHealthConfig = {
  label: string;
  checks: Record<string, unknown>;
};
