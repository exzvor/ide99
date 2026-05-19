import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";

import { useKeymapImport } from "./store";
import type { ExternalKeymapFormat } from "./types";

/**
 * — Keymap import dialog.
 *
 * — minimal scaffold (format picker + textarea + parse button +
 * preview list). , full parsers,
 * conflict-resolution UI, and "Apply to ide99 keymap" action.
 */
export function KeymapImportDialog(): JSX.Element {
  const { t } = useTranslation();
  const parsed = useKeymapImport((s) => s.parsed);
  const parsing = useKeymapImport((s) => s.parsing);
  const error = useKeymapImport((s) => s.parseError);
  const parseFromText = useKeymapImport((s) => s.parseFromText);
  const reset = useKeymapImport((s) => s.reset);

  const [format, setFormat] = useState<ExternalKeymapFormat>("vscode");
  const [raw, setRaw] = useState("");

  const onParse = () => {
    void parseFromText(format, raw);
  };

  return (
    <section
      data-testid="keymap-import-dialog"
      style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t("keymap_import.title")}</h2>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("keymap_import.field.format")}</span>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as ExternalKeymapFormat)}
          data-testid="keymap-import-format"
        >
          <option value="vscode">VS Code</option>
          <option value="datagrip">DataGrip</option>
          <option value="dbeaver">DBeaver</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("keymap_import.field.raw")}</span>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={10}
          data-testid="keymap-import-raw"
          aria-label={t("keymap_import.field.raw")}
          style={{
            fontFamily: "var(--font-mono-q, monospace)",
            fontSize: 12,
            background: "var(--bg)",
            color: "var(--fg)",
            border: "1px solid var(--hairline)",
            padding: 8,
            resize: "vertical",
          }}
        />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onParse}
          disabled={parsing || !raw.trim()}
          data-testid="keymap-import-parse"
        >
          {parsing ? t("keymap_import.action.parsing") : t("keymap_import.action.parse")}
        </button>
        <button type="button" onClick={() => reset()} data-testid="keymap-import-reset">
          {t("keymap_import.action.reset")}
        </button>
      </div>

      {error ? (
        <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
          {error}
        </div>
      ) : null}

      {parsed ? (
        <section
          data-testid="keymap-import-preview"
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            padding: 8,
            background: "var(--bg-elev)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>
            {t("keymap_import.preview.title", { count: parsed.bindings.length })}
          </h3>
          {parsed.warnings.length > 0 ? (
            <ul
              data-testid="keymap-import-warnings"
              style={{ marginTop: 8, paddingLeft: 16, color: "var(--ink-3)", fontSize: 11 }}
            >
              {parsed.warnings.map(
                (
                  w,
                  i, // biome-ignore lint/suspicious/noArrayIndexKey: warnings list is ephemeral (re-parse rebuilds)
                ) => (
                  <li key={i}>
                    {w.key ? t(w.key, { defaultValue: w.message, ...(w.params ?? {}) }) : w.message}
                  </li>
                ),
              )}
            </ul>
          ) : null}
          {parsed.bindings.length === 0 ? (
            <div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 8 }}>
              {t("keymap_import.preview.empty")}
            </div>
          ) : (
            <ul
              style={{
                marginTop: 8,
                paddingLeft: 16,
                fontFamily: "var(--font-mono-q, monospace)",
                fontSize: 11,
              }}
            >
              {parsed.bindings.map((b) => (
                <li key={`${b.sequence}:${b.externalCommand}`}>
                  <code>{b.sequence}</code> → {b.externalCommand}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}
