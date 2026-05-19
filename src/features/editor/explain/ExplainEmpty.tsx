import type { JSX } from "react";
import { useTranslation } from "react-i18next";

/**
 * — placeholder shown when an EXPLAIN tab has no plan yet
 * (idle state). Fills the body of the pane and points the user at the
 * Re-run button on the toolbar.
 */
export function ExplainEmpty(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className="q-empty"
      data-testid="explain-empty"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        height: "100%",
      }}
    >
      <span style={{ opacity: 0.65 }}>{t("editor.explain.empty")}</span>
    </div>
  );
}
