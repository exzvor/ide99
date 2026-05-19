import { invoke } from "@tauri-apps/api/core";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../components/Dialog";

/**
 * — "What we collect" modal (acceptance #1 transparency clause).
 *
 * Lists every event name from the backend `telemetry_known_events` IPC,
 * each with a one-line human description from `privacy.events.<name>`.
 *
 * The list is exhaustive — that's the privacy guarantee. If the backend
 * adds an event, it MUST appear here too (i18n key driven).
 */
export interface WhatWeCollectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatWeCollectDialog({ open, onOpenChange }: WhatWeCollectDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    invoke<string[]>("telemetry_known_events")
      .then((list) => {
        if (!cancelled) {
          setEvents(list);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("privacy.what_we_collect.title")}
      description={t("privacy.what_we_collect.body")}
      size="md"
      closeAriaLabel={t("common.cancel")}
      footer={
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          data-testid="what-we-collect-close"
          className="btn-secondary"
        >
          {t("privacy.what_we_collect.close")}
        </button>
      }
    >
      <div
        data-testid="what-we-collect"
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        {error ? (          <p style={{ margin: 0, fontSize: 12, color: "var(--err, #d33)" }}>{error}</p>
) : null}
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {events.map((name) => (            <li
              key={name}
              data-testid={`event-${name}`}
              style={{
                display: "grid",
                gridTemplateColumns: "min-content 1fr",
                gap: 12,
                fontSize: 12,
                padding: "6px 0",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <code style={{ whiteSpace: "nowrap", color: "var(--ink-2)" }}>{name}</code>
              <span style={{ color: "var(--ink-3)" }}>
                {t(`privacy.events.${name}`, { defaultValue: name })}
              </span>
            </li>
))}
        </ul>
      </div>
    </Dialog>
);
}
