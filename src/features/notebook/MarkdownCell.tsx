/**
 * — Markdown cell.
 *
 * Defaults to preview mode (Jupyter-like). Edit toggle reveals a textarea;
 * blurring the textarea (or pressing Esc) returns to preview. Variables
 * `{{ cell_N.result.col }}` are substituted from preceding cells'
 * snapshots; the renderer is dependency-free (`markdownVars.ts`).
 */
import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";

import { renderMarkdown, substituteVariables } from "./markdownVars";
import type { Cell, MarkdownCell as MarkdownCellT } from "./types";

interface Props {
  cell: MarkdownCellT;
  notebookCells: Cell[];
  onChange: (next: MarkdownCellT) => void;
}

export function MarkdownCell({ cell, notebookCells, onChange }: Props): JSX.Element {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<boolean>(cell.source.trim() === "");

  const html = renderMarkdown(substituteVariables(cell.source, notebookCells, { mode: "html" }));

  return (    <div
      data-testid={`md-cell-${cell.id}`}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          data-testid={`md-cell-${cell.id}-toggle`}
          onClick={() => setEditing((v) => !v)}
          className="btn btn-ghost"
          aria-label={editing ? t("notebook.markdown.preview") : t("notebook.markdown.edit")}
        >
          {editing ? t("notebook.markdown.preview") : t("notebook.markdown.edit")}
        </button>
      </div>
      {editing ? (        <textarea
          data-testid={`md-cell-${cell.id}-source`}
          value={cell.source}
          onChange={(e) => onChange({ ...cell, source: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label={t("notebook.markdown.edit")}
          style={{
            width: "100%",
            minHeight: 96,
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 13,
            background: "var(--bg)",
            color: "var(--fg)",
            border: "1px solid var(--hairline)",
            padding: 8,
            resize: "vertical",
          }}
        />
) : (        // biome-ignore lint/a11y/useSemanticElements: native <button> would not allow rendering arbitrary markdown HTML inside; role/tabIndex/keys are wired by hand.
        <div
          data-testid={`md-cell-${cell.id}-preview`}
          role="button"
          tabIndex={0}
          aria-label={t("notebook.markdown.edit")}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes input and strips dangerous link schemes; see markdownVars.ts
          dangerouslySetInnerHTML={{
            __html:
              html.length > 0
                ? html
                : `<em style="color:var(--muted, #888)">${t("notebook.markdown.empty_hint")}</em>`,
          }}
          style={{ fontSize: 14, lineHeight: 1.55, cursor: "text" }}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing(true);
            }
          }}
        />
)}
    </div>
);
}
