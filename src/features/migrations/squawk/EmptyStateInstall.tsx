/**
 * —
 *
 * Sticky banner mounted at the top of MigrationsPanel when the Squawk
 * binary is not on PATH. Shows a platform-aware install command and a
 * Copy button. Dismiss is per-session (driven by the parent's local
 * state — not persisted).
 */

import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";

const COMMAND_BY_PLATFORM = {
  mac: "brew install squawk",
  windows: "cargo install squawk-cli",
  other: "cargo install squawk-cli",
} as const;

function detectPlatform(): keyof typeof COMMAND_BY_PLATFORM {
  const p = (navigator.platform || "").toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("win")) return "windows";
  return "other";
}

interface Props {
  onDismiss: () => void;
}

export function EmptyStateInstall(props: Props): JSX.Element {
  const { t } = useTranslation();
  const platform = detectPlatform();
  const command = COMMAND_BY_PLATFORM[platform];
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard may be denied
    }
  };

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: passive banner; not a form <output>.
      role="status"
      data-testid="squawk-install-banner"
      style={{
        padding: "10px 12px",
        background: "var(--accent-soft, rgba(212,155,28,0.08))",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        marginBottom: 8,
        fontSize: 12,
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {t("migrations.squawk.installBanner.title")}
        </div>
        <div style={{ marginBottom: 6 }}>{t("migrations.squawk.installBanner.body")}</div>
        <code
          style={{
            background: "var(--bg, rgba(0,0,0,0.06))",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {command}
        </code>
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          void handleCopy();
        }}
      >
        {copied
          ? t("migrations.squawk.installBanner.copied")
          : t("migrations.squawk.installBanner.copy")}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={props.onDismiss}
        aria-label={t("migrations.squawk.installBanner.dismiss")}
      >
        ✕
      </button>
    </div>
  );
}
