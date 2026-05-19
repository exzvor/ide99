import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "../../components/Toast";
import { TypingConfirmModal } from "../../components/TypingConfirmModal";
import { WhatWeCollectDialog } from "./WhatWeCollectDialog";
import { useAppSettings } from "./store";
import type { TelemetryEndpoint } from "./types";

/**
 * — Settings → Privacy panel.
 *
 * - Telemetry on/off + endpoint (eu/ru/none).
 * - Crash reports on/off (with preview, never auto-sent).
 * - "What we collect" button → exhaustive event list modal.
 * - Clear all data → wipes UUID + flips both toggles to false.
 */
export function PrivacyPanel(): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useAppSettings((s) => s.settings);
  const hydrate = useAppSettings((s) => s.hydrate);
  const setSettings = useAppSettings((s) => s.setSettings);
  const clearAll = useAppSettings((s) => s.clearAll);
  const [whatOpen, setWhatOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    if (!settings) void hydrate();
  }, [settings, hydrate]);

  if (!settings) {
    return <div style={{ padding: 16, color: "var(--ink-3)" }}>{t("privacy.loading")}</div>;
  }

  const setTelemetry = (enabled: boolean) =>
    void setSettings({ ...settings, telemetryEnabled: enabled, privacyChoiceMade: true });

  const setCrash = (enabled: boolean) =>
    void setSettings({ ...settings, crashReportsEnabled: enabled, privacyChoiceMade: true });

  const setEndpoint = (endpoint: TelemetryEndpoint) =>
    void setSettings({ ...settings, telemetryEndpoint: endpoint });

  return (    <section
      data-testid="privacy-panel"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16, maxWidth: 640 }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t("privacy.title")}</h2>

      <div
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: 12,
          background: "var(--bg-elev)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{t("privacy.telemetry.title")}</h3>
        <p style={{ margin: "8px 0", fontSize: 12, color: "var(--ink-3)" }}>
          {t("privacy.telemetry.description")}
        </p>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={settings.telemetryEnabled}
            onChange={(e) => setTelemetry(e.target.checked)}
            data-testid="privacy-telemetry-toggle"
          />
          <span>{t("privacy.telemetry.enable")}</span>
        </label>
        <div style={{ marginTop: 8 }}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span>{t("privacy.telemetry.endpoint")}</span>
            <select
              value={settings.telemetryEndpoint}
              onChange={(e) => setEndpoint(e.target.value as TelemetryEndpoint)}
              data-testid="privacy-endpoint"
              disabled={!settings.telemetryEnabled}
            >
              <option value="eu">telemetry.ide99.io (EU)</option>
              <option value="ru">telemetry.ide99.ru (RU)</option>
              <option value="none">{t("privacy.telemetry.endpoint_none")}</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setWhatOpen(true)}
            data-testid="privacy-what-we-collect"
            className="btn-secondary"
          >
            {t("privacy.what_we_collect.button")}
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: 12,
          background: "var(--bg-elev)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{t("privacy.crash.title")}</h3>
        <p style={{ margin: "8px 0", fontSize: 12, color: "var(--ink-3)" }}>
          {t("privacy.crash.description")}
        </p>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={settings.crashReportsEnabled}
            onChange={(e) => setCrash(e.target.checked)}
            data-testid="privacy-crash-toggle"
          />
          <span>{t("privacy.crash.enable")}</span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setConfirmClearOpen(true)}
          data-testid="privacy-clear-all"
          style={{ color: "var(--err, #d33)" }}
        >
          {t("privacy.clear_all")}
        </button>
      </div>

      {settings.deviceUuid ? (        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {t("privacy.device_uuid", { uuid: settings.deviceUuid })}
        </div>
) : null}

      <WhatWeCollectDialog open={whatOpen} onOpenChange={setWhatOpen} />
      {confirmClearOpen ? (        <TypingConfirmModal
          title={t("privacy.clear_all_confirm.title")}
          description={t("privacy.clear_all_confirm.body")}
          expectedToken={t("privacy.clear_all_confirm.expected_token")}
          inputLabel={t("privacy.clear_all_confirm.type_prompt")}
          confirmLabel={t("privacy.clear_all_confirm.confirm")}
          cancelLabel={t("privacy.clear_all_confirm.cancel")}
          onCancel={() => setConfirmClearOpen(false)}
          onConfirm={async () => {
            try {
              await clearAll();
              toast.success(t("privacy.clear_all_confirm.success"));
            } catch {
              toast.error(t("privacy.clear_all_confirm.error"));
            } finally {
              setConfirmClearOpen(false);
            }
          }}
        />
) : null}
    </section>
);
}
