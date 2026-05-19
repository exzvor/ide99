// — Local minimal HelpLink fallback.
// TODO(B3->B4 integrate): swap to `shared/HelpLink.tsx` once B4 lands.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { openExternalUrl } from "../../../lib/tauri";

export const HELP_URLS: Record<string, string> = {
  table: "https://www.postgresql.org/docs/current/sql-createtable.html",
  view: "https://www.postgresql.org/docs/current/sql-createview.html",
  matview: "https://www.postgresql.org/docs/current/sql-creatematerializedview.html",
  index: "https://www.postgresql.org/docs/current/sql-createindex.html",
  sequence: "https://www.postgresql.org/docs/current/sql-createsequence.html",
  // — function/procedure/trigger editor topics (cross-cutting addition).
  function: "https://www.postgresql.org/docs/current/sql-createfunction.html",
  procedure: "https://www.postgresql.org/docs/current/sql-createprocedure.html",
  trigger: "https://www.postgresql.org/docs/current/sql-createtrigger.html",
  // — FDW / publication / subscription / role / type editors.
  fdw_server: "https://www.postgresql.org/docs/current/sql-createserver.html",
  publication: "https://www.postgresql.org/docs/current/sql-createpublication.html",
  subscription: "https://www.postgresql.org/docs/current/sql-createsubscription.html",
  role: "https://www.postgresql.org/docs/current/sql-createrole.html",
  enum_type: "https://www.postgresql.org/docs/current/sql-createtype.html",
  composite_type: "https://www.postgresql.org/docs/current/sql-createtype.html",
  domain_type: "https://www.postgresql.org/docs/current/sql-createdomain.html",
  range_type: "https://www.postgresql.org/docs/current/sql-createtype.html",
};

export interface HelpLinkProps {
  topic: keyof typeof HELP_URLS | string;
  /** Inject window.open for testability (defaults to real `window.open`). */
  openExternal?: (url: string) => void;
}

export function HelpLink({ topic, openExternal }: HelpLinkProps): JSX.Element {
  const { t } = useTranslation();
  const url = HELP_URLS[topic] ?? HELP_URLS.table;
  return (    <button
      type="button"
      data-testid="object-editor-help-link"
      data-topic={topic}
      aria-label={t("object_editor.actions.help")}
      className="btn-ghost"
      onClick={() => {
        if (openExternal) {
          openExternal(url);
          return;
        }
        // Tauri 2 doesn't route `window.open(_, "_blank")` to the OS browser,
        // so we go through a backend command that calls the platform opener.
        void openExternalUrl(url).catch(() => {
          // Best-effort fallback for the web build / tests where the IPC
          // bridge is unavailable.
          if (typeof window !== "undefined" && typeof window.open === "function") {
            window.open(url, "_blank", "noopener");
          }
        });
      }}
      style={{
        background: "transparent",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      ↗ {t("object_editor.actions.help")}
    </button>
);
}
