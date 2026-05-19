import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { modKey } from "../../lib/platform";

/**
 * Centered empty state shown when zero tabs are open (spec §5.1, §7.3).
 *
 * The CTA copy points at the Cmd/Ctrl+T global hotkey wired in Workspace
 * (modifier label is platform-detected).
 */
export function EmptyState(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "0 24px",
        textAlign: "center",
      }}
      data-testid="editor-empty"
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink-2)",
          margin: 0,
        }}
      >
        {t("editor.empty.title")}
      </h3>
      <p style={{ fontSize: 12.5, color: "var(--ink-4)", margin: 0, maxWidth: 320 }}>
        {t("editor.empty.body", { cmd: modKey() })}
      </p>
    </div>
  );
}
