// src/features/editor/UnrepresentableBar.tsx
import { useTranslation } from "react-i18next";

export interface UnrepresentableBarProps {
  /**
   * Slug emitted by the Rust SELECT parser when the query shape can't be
   * represented in the column-filter UI. See `src-tauri/src/parser/select.rs`
   * (`empty_unrep_shape`) for the canonical slug list.
   */
  slug: string;
}

/**
 * Map of stable parser slugs to their localized reason key. New slugs added
 * on the Rust side fall back to the slug text itself, which keeps the banner
 * informative even before locales catch up.
 */
const REASON_I18N_KEY: Record<string, string> = {
  "group-by": "filter.unrepresentableReason.group_by",
  having: "filter.unrepresentableReason.having",
  window: "filter.unrepresentableReason.window",
  "with-cte": "filter.unrepresentableReason.with_cte",
  "multiple-from": "filter.unrepresentableReason.multiple_from",
  "complex-from": "filter.unrepresentableReason.complex_from",
  "non-flat-from": "filter.unrepresentableReason.non_flat_from",
  "multi-column-order": "filter.unrepresentableReason.multi_column_order",
  "order-shape": "filter.unrepresentableReason.order_shape",
  "order-expr": "filter.unrepresentableReason.order_expr",
  "where-expr": "filter.unrepresentableReason.where_expr",
};

export function UnrepresentableBar({ slug }: UnrepresentableBarProps) {
  const { t } = useTranslation();
  // `no-from` is a scalar SELECT (e.g. `SELECT 1`, `SELECT now()`); column
  // filters don't apply to it, so the banner would just be noise.
  if (slug === "no-from") return null;

  const reasonKey = REASON_I18N_KEY[slug];
  const reason = reasonKey ? t(reasonKey) : slug;

  return (
    <div
      className="unrepresentable-bar"
      // biome-ignore lint/a11y/useSemanticElements: passive informational banner with text + ⚠ glyph + interpolated reason; <output> doesn't accept this content cleanly.
      role="status"
    >
      ⚠ {t("filter.unrepresentableHint", { reason })}
    </div>
  );
}
