// — small "PostgreSQL docs" link, used as the bottom-left affordance
// in every object editor.
//
// Spec deviation note: the plan calls for
// `import { open } from "@tauri-apps/plugin-shell"` to launch the OS browser.
// That plugin is not currently a dependency of this project (only
// @tauri-apps/api and @tauri-apps/plugin-dialog are installed). To avoid
// adding a new native dependency mid-sprint, this component falls back to
// `window.open(url, "_blank", "noopener,noreferrer")` which is sufficient
// for the WebView-hosted Tauri shell. If/when the plugin is added, swap
// the implementation here without touching call-sites.

import { ExternalLink } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { openExternalUrl } from "../../../lib/tauri";

export type HelpTopic = "table" | "view" | "matview" | "index" | "sequence";

export const HELP_URLS: Record<HelpTopic, string> = {
  table: "https://www.postgresql.org/docs/current/sql-createtable.html",
  view: "https://www.postgresql.org/docs/current/sql-createview.html",
  matview: "https://www.postgresql.org/docs/current/sql-creatematerializedview.html",
  index: "https://www.postgresql.org/docs/current/sql-createindex.html",
  sequence: "https://www.postgresql.org/docs/current/sql-createsequence.html",
};

interface Props {
  topic: HelpTopic;
}

// Rendered as a real <button> (not <span role="button">) so:
// - native Enter/Space activation handled by the browser,
// - keyboard tab-focus comes for free,
// - biome a11y/useSemanticElements is satisfied.
export function HelpLink({ topic }: Props): JSX.Element {
  const { t } = useTranslation();
  const url = HELP_URLS[topic];

  const open = (): void => {
    // Tauri 2 doesn't intercept `window.open(_, "_blank")` to the OS
    // browser by default; it either swallows the call or opens a new
    // webview window with our CSP, which then refuses postgresql.org.
    // Route through the Rust `open_external_url` command instead, with a
    // `window.open` fallback for tests / non-Tauri envs.
    void openExternalUrl(url).catch(() => {
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  };

  return (
    <button
      type="button"
      aria-label={t("object_editor.actions.help")}
      onClick={open}
      data-testid="help-link"
      data-topic={topic}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        cursor: "pointer",
        color: "var(--accent, #4a90e2)",
        fontSize: 13,
        userSelect: "none",
        background: "transparent",
        border: "none",
        padding: 0,
      }}
    >
      <ExternalLink size={14} aria-hidden="true" />
      {t("object_editor.actions.help")}
    </button>
  );
}
