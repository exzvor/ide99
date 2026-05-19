import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";

/**
 * Universal "show me the full value" modal used by Cell renderers.
 *
 * Single-line truncated cells (json/long text) call this on double-click
 * to expose the entire value. JSON gets pretty-printed via a forgiving
 * `JSON.parse` + `JSON.stringify(..., null, 2)`; malformed JSON falls
 * back to the raw input so a partially-quoted column still shows
 * something usable.
 */
export interface ValueModalProps {
  open: boolean;
  onClose: () => void;
  value: string;
  language: "json" | "text";
}

function pretty(value: string, language: ValueModalProps["language"]): string {
  if (language !== "json") return value;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function ValueModal({ open, onClose, value, language }: ValueModalProps): JSX.Element {
  const { t } = useTranslation();
  return (    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        language === "json"
          ? t("editor.value_modal.title_json")
          : t("editor.value_modal.title_text")
      }
      description=""
    >
      <pre
        className="q-scroll"
        style={{
          maxHeight: "60vh",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          background: "var(--bg-sunken)",
          padding: 12,
          borderRadius: 8,
          margin: 0,
          fontFamily: "var(--font-mono-q)",
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--ink-2)",
          userSelect: "text",
        }}
        data-testid="value-modal-pre"
      >
        {pretty(value, language)}
      </pre>
    </Dialog>
);
}
