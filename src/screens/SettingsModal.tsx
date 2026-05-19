import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShareImportPanel } from "../features/file-sharing";
import { KeymapImportDialog } from "../features/keymap-import";
import { SettingsMcp } from "../features/mcp/SettingsMcp";
import { ModulesSettingsPanel } from "../features/paid-modules";
import { PrivacyPanel } from "../features/privacy/PrivacyPanel";
import { SettingsSnippets } from "../features/snippets/SettingsSnippets";
import { UpdateChecker } from "../features/updater";

/**
 * — global Settings modal.
 *
 * Mounted once at App root. Opened via the gear button in the left-rail
 * footer or via the global Cmd/Ctrl+, hotkey listener in App.tsx.
 *
 * — добавлен tab `mcp` (Model Context Protocol server для
 * подключения внешних AI-агентов: Claude Code, Cursor, Windsurf).
 * См. `src/features/mcp/SettingsMcp.tsx`.
 */
export function SettingsModal(): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("snippets");

  // Listen on the window for the open-settings event so the gear button +
  // the global Cmd/Ctrl+, listener share a single open() pathway.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab) setTab(detail.tab);
      setOpen(true);
    };
    window.addEventListener("ide99:open-settings", handler);
    return () => window.removeEventListener("ide99:open-settings", handler);
  }, []);

  return (    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="settings-overlay" />
        <Dialog.Content className="settings-content" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{t("settings.title")}</Dialog.Title>
          <header className="settings-header">
            <h1>{t("settings.title")}</h1>
            <Dialog.Close className="settings-close" aria-label={t("common.cancel")}>
              ×
            </Dialog.Close>
          </header>
          <Tabs.Root value={tab} onValueChange={setTab} className="settings-tabs">
            <Tabs.List className="settings-tabs-list">
              <Tabs.Trigger value="snippets" className="settings-tab">
                {t("settings.tabs.snippets")}
              </Tabs.Trigger>
              <Tabs.Trigger value="mcp" className="settings-tab">
                {t("settings.tabs.mcp")}
              </Tabs.Trigger>
              {/* — Modules tab between MCP and Privacy. */}
              <Tabs.Trigger value="modules" className="settings-tab">
                {t("settings.tabs.modules")}
              </Tabs.Trigger>
              {/* �� keymap import dialog в коде есть, но не имел entry point. */}
              <Tabs.Trigger value="keymap" className="settings-tab">
                {t("settings.tabs.keymap")}
              </Tabs.Trigger>
              {/* �� `.ide99` import был только в коде, теперь reachable из Settings. */}
              <Tabs.Trigger value="sharing" className="settings-tab">
                {t("settings.tabs.sharing")}
              </Tabs.Trigger>
              {/* �� auto-updater UI был implemented but unmounted. */}
              <Tabs.Trigger value="updates" className="settings-tab">
                {t("settings.tabs.updates")}
              </Tabs.Trigger>
              <Tabs.Trigger value="privacy" className="settings-tab">
                {t("settings.tabs.privacy")}
              </Tabs.Trigger>
            </Tabs.List>
            <div className="settings-body">
              <Tabs.Content value="snippets">
                <SettingsSnippets />
              </Tabs.Content>
              <Tabs.Content value="mcp">
                <SettingsMcp />
              </Tabs.Content>
              <Tabs.Content value="modules">
                <ModulesSettingsPanel />
              </Tabs.Content>
              <Tabs.Content value="keymap">
                <KeymapImportDialog />
              </Tabs.Content>
              <Tabs.Content value="sharing">
                <ShareImportPanel />
              </Tabs.Content>
              <Tabs.Content value="updates">
                <UpdateChecker />
              </Tabs.Content>
              <Tabs.Content value="privacy">
                <PrivacyPanel />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
);
}

/** Imperative open helper — used by the gear button + global hotkey. */
export function openSettings(tab?: string): void {
  window.dispatchEvent(new CustomEvent("ide99:open-settings", { detail: { tab } }));
}
