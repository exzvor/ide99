import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BackupTab } from "../editor/store";
import { BackupWizard } from "./BackupWizard";
import { BaseBackupWizard } from "./BaseBackupWizard";
import { RestoreWizard } from "./RestoreWizard";
import { ScheduleManager } from "./ScheduleManager";
import { useBackup } from "./store";

type Section = "backup" | "restore" | "basebackup" | "schedule";

/**
 * — Backup / Restore center.
 *
 * Four-section navigator: Backup wizard, Restore wizard, Base-backup wizard
 * (cluster-level pg_basebackup), Schedule manager.
 */
export function BackupCenter({ tab }: { tab: BackupTab }): JSX.Element {
  const { t } = useTranslation();
  const hydrate = useBackup((s) => s.hydrate);
  const loaded = useBackup((s) => s.loaded);
  const [section, setSection] = useState<Section>("backup");

  useEffect(() => {
    if (!loaded) {
      void hydrate();
    }
  }, [loaded, hydrate]);

  const sections: Array<{ id: Section; labelKey: string }> = [
    { id: "backup", labelKey: "backup.section.backup" },
    { id: "restore", labelKey: "backup.section.restore" },
    { id: "basebackup", labelKey: "backup.section.basebackup" },
    { id: "schedule", labelKey: "backup.section.schedule" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "auto",
      }}
      data-testid="backup-center"
    >
      <nav
        style={{
          display: "flex",
          gap: 8,
          padding: 12,
          borderBottom: "1px solid var(--hairline)",
        }}
        aria-label={t("backup.section.nav_label")}
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            data-testid={`backup-section-${s.id}`}
            aria-pressed={section === s.id}
            style={{
              fontWeight: section === s.id ? 600 : 400,
              padding: "4px 10px",
              border: "1px solid var(--hairline)",
              background: section === s.id ? "var(--accent-soft)" : "var(--bg-elev)",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
        {section === "backup" ? <BackupWizard connectionId={tab.connectionId} /> : null}
        {section === "restore" ? <RestoreWizard connectionId={tab.connectionId} /> : null}
        {section === "basebackup" ? <BaseBackupWizard connectionId={tab.connectionId} /> : null}
        {section === "schedule" ? <ScheduleManager connectionId={tab.connectionId} /> : null}
      </div>
    </div>
  );
}
