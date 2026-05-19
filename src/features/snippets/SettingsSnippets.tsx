/**
 * — Settings → Snippets section.
 *
 * Lists built-in templates inside a collapsed `<details>` block (read-
 * only) and user snippets in an editable table. Toolbar wires up New /
 * Import / Export. Edit and Delete are per-row.
 *
 * Loads on mount; the store keeps the list cached so tab switches inside
 * Settings don't refetch.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import type { UserSnippet } from "../../lib/tauri";
import { BUILTIN_SNIPPETS } from "../editor/autocomplete/snippets";
import { SnippetEditor } from "./SnippetEditor";
import { useSnippets } from "./store";

function formatBackendError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
) {
    return (err as { message: string }).message;
  }
  return String(err);
}

export function SettingsSnippets() {
  const { t } = useTranslation();
  const toast = useToast();
  const userSnippets = useSnippets((s) => s.userSnippets);
  const load = useSnippets((s) => s.load);
  const del = useSnippets((s) => s.delete);
  const exportToFile = useSnippets((s) => s.exportToFile);
  const importFromFile = useSnippets((s) => s.importFromFile);
  const [editing, setEditing] = useState<UserSnippet | null>(null);
  const [creating, setCreating] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load() is store action, stable identity
  useEffect(() => {
    load().catch((err) => toast.error(formatBackendError(err)));
  }, []);

  const handleDelete = async (id: number) => {
    try {
      await del(id);
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };
  const handleExport = async () => {
    try {
      await exportToFile();
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };
  const handleImport = async () => {
    try {
      await importFromFile();
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  return (    <section className="settings-snippets">
      <header>
        <h2>{t("settings.snippets.title")}</h2>
        <div className="toolbar">
          <button type="button" onClick={() => setCreating(true)}>
            + {t("snippets.toolbar.new")}
          </button>
          <button type="button" onClick={handleImport}>
            {t("snippets.toolbar.import")}
          </button>
          <button type="button" onClick={handleExport}>
            {t("snippets.toolbar.export")}
          </button>
        </div>
      </header>

      <details>
        <summary>{t("settings.snippets.builtins", { count: BUILTIN_SNIPPETS.length })}</summary>
        <ul className="snippet-list snippet-list-builtin">
          {BUILTIN_SNIPPETS.map((s) => (            <li key={s.id}>
              <span className="label">{s.label}</span>
              <span className="prefix">{s.prefixes.join(", ")}</span>
            </li>
))}
        </ul>
      </details>

      <h3>{t("settings.snippets.mySnippets", { count: userSnippets.length })}</h3>
      {userSnippets.length === 0 ? (        <p className="empty">{t("settings.snippets.empty")}</p>
) : (        <ul className="snippet-list">
          {userSnippets.map((s) => (            <li key={s.id}>
              <span className="label">{s.label}</span>
              <span className="prefix">{s.prefix}</span>
              <button type="button" onClick={() => setEditing(s)}>
                {t("common.edit")}
              </button>
              <button type="button" onClick={() => handleDelete(s.id)}>
                {t("common.delete")}
              </button>
            </li>
))}
        </ul>
)}

      <SnippetEditor
        open={creating || editing !== null}
        editing={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </section>
);
}
