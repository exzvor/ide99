// Backup / Restore DTOs — mirror src-tauri/src/backup/types.rs (camelCase via serde).

export type DumpFormat = "custom" | "plain" | "directory" | "tar";

export type DumpScope = "both" | "dataonly" | "schemaonly";

export type BaseBackupCompression = "none" | "gzip" | "lz4" | "zstd";

export type BackupOptions = {
  connectionId: string;
  format: DumpFormat;
  scope: DumpScope;
  includeSchemas?: string[];
  includeTables?: string[];
  excludeTableData?: string[];
  compressLevel: number;
  parallelJobs?: number | null;
  outputPath: string;
  includeCreateDb?: boolean;
  noOwner?: boolean;
};

export type RestoreOptions = {
  connectionId: string;
  sourcePath: string;
  cleanBeforeRestore?: boolean;
  createDatabase?: boolean;
  noOwner?: boolean;
  parallelJobs?: number | null;
  selectedObjects?: string[];
};

export type BaseBackupOptions = {
  connectionId: string;
  outputDir: string;
  incrementalFromManifest?: string | null;
  compression: BaseBackupCompression;
};

export type ProgressEvent =
  | { kind: "phase"; jobId: string; phase: string; detail?: string | null }
  | { kind: "percent"; jobId: string; value: number }
  | {
      kind: "done";
      jobId: string;
      success: boolean;
      exitCode?: number | null;
      stderrTail: string;
    };

export type ScheduleEntry = {
  id: string;
  label: string;
  cron: string;
  backup: BackupOptions;
  createdAt: string;
  installed?: boolean;
  lastRunAt?: string | null;
  lastRunOk?: boolean | null;
};

export type BackupError = {
  code:
    | "connection_not_found"
    | "binary_unavailable"
    | "invalid_input"
    | "io_error"
    | "subprocess_failed"
    | "schedule_error";
  message: string;
};
