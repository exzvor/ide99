// Updater DTOs — mirror src-tauri/src/updater/types.rs.

export type ReleaseChannel = "stable" | "beta" | "nightly";

export type PlatformAsset = {
  signature: string;
  url: string;
};

export type UpdateManifest = {
  version: string;
  notes: string;
  pubDate: string;
  platforms: Record<string, PlatformAsset>;
};

export type CheckResult =
  | {
      kind: "upToDate";
      currentVersion: string;
      channel: ReleaseChannel;
      checkedAt: string;
    }
  | {
      kind: "available";
      currentVersion: string;
      manifest: UpdateManifest;
      channel: ReleaseChannel;
      checkedAt: string;
    }
  | {
      kind: "error";
      message: string;
      channel: ReleaseChannel;
      checkedAt: string;
    };

export type UpdaterError = {
  code: "storage_error" | "network_error" | "invalid_manifest" | "install_failed";
  message: string;
};

/// Wire shape of `updater:progress` events. Backend emits four phases:
/// started | downloading | installing | done.
export type ProgressEvent = {
  phase: "started" | "downloading" | "installing" | "done";
  bytesDownloaded: number;
  bytesTotal: number | null;
};
