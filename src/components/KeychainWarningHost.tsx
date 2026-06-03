import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "./Toast";

/**
 * One-time warning when no OS keychain is available (issue #25).
 *
 * Normally passwords go to the macOS Keychain / Windows Credential Manager /
 * Linux Secret Service. On a headless or locked-down box with none of those
 * (e.g. a closed-network Linux server), storage falls back to a local 0600
 * file. That still persists across restarts — the old bug was that it didn't —
 * but the user should know their credentials aren't in the OS keychain.
 *
 * Renders nothing; just shows a warning toast once per launch if degraded.
 */
let warned = false;

export function KeychainWarningHost(): null {
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (warned) return;
    let cancelled = false;
    void invoke<boolean>("keychain_degraded")
      .then((degraded) => {
        if (degraded && !cancelled && !warned) {
          warned = true;
          toast.warning(
            t("keychain.degraded_warning", {
              defaultValue:
                "No system keychain found — connection passwords are saved to a local file (readable only by you). Install a Secret Service (e.g. gnome-keyring) for OS-backed storage.",
            }),
          );
        }
      })
      .catch(() => {
        // Command unavailable (non-Tauri / test env) — nothing to warn about.
      });
    return () => {
      cancelled = true;
    };
  }, [toast, t]);

  return null;
}
