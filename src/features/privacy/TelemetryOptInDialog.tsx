import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../components/Dialog";
import { WhatWeCollectDialog } from "./WhatWeCollectDialog";
import { useAppSettings } from "./store";

/**
 * — first-launch opt-in dialog (acceptance criterion #1).
 *
 * Renders only when `settings.privacyChoiceMade === false`. Three buttons:
 * - "What we collect" (opens secondary modal listing every known event)
 * - "No, just open"   (telemetryEnabled=false, crashReportsEnabled=false,
 * privacyChoiceMade=true)
 * - "Yes, send"       (both true, mints device_uuid in backend store)
 *
 * The user MUST make a choice — Esc / outside click are disabled. Only the
 * three explicit buttons dismiss the dialog. This is the privacy guarantee
 * md §4.
 */
export function TelemetryOptInDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const settings = useAppSettings((s) => s.settings);
  const hydrate = useAppSettings((s) => s.hydrate);
  const setSettings = useAppSettings((s) => s.setSettings);
  const [whatOpen, setWhatOpen] = useState(false);

  useEffect(() => {
    if (!settings) void hydrate();
  }, [settings, hydrate]);

  if (!settings || settings.privacyChoiceMade) return null;

  const decline = () =>
    void setSettings({
      ...settings,
      telemetryEnabled: false,
      crashReportsEnabled: false,
      privacyChoiceMade: true,
      privacyChoiceMadeAt: new Date().toISOString(),
    });

  const accept = () =>
    void setSettings({
      ...settings,
      telemetryEnabled: true,
      crashReportsEnabled: true,
      privacyChoiceMade: true,
      privacyChoiceMadeAt: new Date().toISOString(),
    });

  return (    <>
      <Dialog
        open
        onOpenChange={() => {
          /* opt-in must not auto-dismiss — only buttons dismiss */
        }}
        title={t("privacy.opt_in.title")}
        // Radix renders this as <Dialog.Description> for a11y. We
        // intentionally do NOT also paint the body string as a child <p>
        // below — that was the bug where the same paragraph
        // appeared twice on screen.
        description={t("privacy.opt_in.body")}
        size="sm"
        closeOnEscape={false}
        closeOnOutsideClick={false}
        footer={
          <>
            <button
              type="button"
              onClick={() => setWhatOpen(true)}
              data-testid="opt-in-what"
              className="btn-secondary"
            >
              {t("privacy.opt_in.what_we_collect")}
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={decline}
              data-testid="opt-in-decline"
              className="btn-secondary"
            >
              {t("privacy.opt_in.decline")}
            </button>
            <button
              type="button"
              onClick={accept}
              data-testid="opt-in-accept"
              className="btn-primary"
              style={{ fontWeight: 600 }}
            >
              {t("privacy.opt_in.accept")}
            </button>
          </>
        }
      >
        <div
          data-testid="telemetry-opt-in"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <p style={{ margin: 0, fontSize: 11, color: "var(--ink-3)" }}>
            {t("privacy.opt_in.footer")}
          </p>
        </div>
      </Dialog>
      <WhatWeCollectDialog open={whatOpen} onOpenChange={setWhatOpen} />
    </>
);
}
