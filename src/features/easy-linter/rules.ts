/**
 * — common-mistakes linter for DML/SELECT.
 *
 * Disjoint from Squawk (which is DDL-only via `migrations/squawk/`).
 * Active only in Easy mode (gated by `useUiMode`). Adds Monaco markers
 * with `source: "easy-mistakes"` so the existing Squawk markers
 * (`source: "squawk"`) coexist without overwrite.
 *
 * Each rule is a plain data record (id, message, optional fix, severity);
 * the matcher logic for each id lives in `lint.ts` so this module stays
 * trivially serialisable / i18n-friendly.
 */

export interface EasyLintRule {
  id: string;
  /** Headline shown as Monaco marker message + tooltip. */
  message: { en: string; ru: string };
  /** Suggested fix snippet — copy-paste friendly. */
  fix?: { en: string; ru: string };
  /** Severity: `info` underline (orange in Easy theme), `warning` (red). */
  severity: "info" | "warning";
}

/**
 * 12 common DML/SELECT mistakes — bilingual.
 *
 * Limitation (documented): the matchers are regex-based and do NOT parse
 * SQL grammatically. A literal string `'WHERE col = NULL'` inside a quoted
 * string or `--` comment will produce a false-positive. This is acceptable
 * for an Easy-mode hint underline; the user can disable Easy mode if it
 * gets in the way.
 */
export const EASY_RULES: EasyLintRule[] = [
  {
    id: "where_eq_null",
    message: {
      en: "Comparison with NULL using = / <> always returns NULL.",
      ru: "Сравнение с NULL через = / <> всегда возвращает NULL.",
    },
    fix: {
      en: "Use IS NULL / IS NOT NULL instead.",
      ru: "Используйте IS NULL / IS NOT NULL.",
    },
    severity: "warning",
  },
  {
    id: "select_distinct_star",
    message: {
      en: "SELECT DISTINCT * usually masks a join or grouping problem.",
      ru: "SELECT DISTINCT * обычно скрывает проблему с join'ом или группировкой.",
    },
    fix: {
      en: "List the columns you actually need and revisit the join.",
      ru: "Перечислите нужные колонки явно и проверьте join.",
    },
    severity: "info",
  },
  {
    id: "order_by_index",
    message: {
      en: "ORDER BY by ordinal index is fragile — column order may change.",
      ru: "ORDER BY по номеру колонки хрупок — порядок колонок может измениться.",
    },
    fix: {
      en: "Order by an explicit column or alias.",
      ru: "Сортируйте по имени колонки или алиасу.",
    },
    severity: "info",
  },
  {
    id: "limit_without_order",
    message: {
      en: "LIMIT without ORDER BY returns an unspecified row set.",
      ru: "LIMIT без ORDER BY возвращает произвольное подмножество строк.",
    },
    fix: {
      en: "Add ORDER BY so the truncation is deterministic.",
      ru: "Добавьте ORDER BY, чтобы выборка была детерминированной.",
    },
    severity: "warning",
  },
  {
    id: "like_no_wildcard",
    message: {
      en: "LIKE without % or _ is just an equality check.",
      ru: "LIKE без % и _ — это обычное равенство.",
    },
    fix: {
      en: "Use = for exact match, or add % / _ to the pattern.",
      ru: "Используйте = для точного совпадения или добавьте % / _ в шаблон.",
    },
    severity: "info",
  },
  {
    id: "update_no_where",
    message: {
      en: "UPDATE without WHERE rewrites every row in the table.",
      ru: "UPDATE без WHERE перезапишет все строки таблицы.",
    },
    fix: {
      en: "Add a WHERE clause that scopes the update.",
      ru: "Добавьте WHERE, ограничивающий обновление.",
    },
    severity: "warning",
  },
  {
    id: "delete_no_where",
    message: {
      en: "DELETE without WHERE empties the entire table.",
      ru: "DELETE без WHERE удаляет все строки таблицы.",
    },
    fix: {
      en: "Add a WHERE clause that scopes the delete.",
      ru: "Добавьте WHERE, ограничивающий удаление.",
    },
    severity: "warning",
  },
  {
    id: "cross_join_implicit",
    message: {
      en: "Comma-separated FROM list without WHERE is a Cartesian product.",
      ru: "FROM с запятой без WHERE — это декартово произведение таблиц.",
    },
    fix: {
      en: "Use explicit JOIN ... ON, or add a WHERE join condition.",
      ru: "Используйте JOIN ... ON или добавьте условие в WHERE.",
    },
    severity: "warning",
  },
  {
    id: "count_star_distinct",
    message: {
      en: "COUNT(*) counts rows, not distinct values — confirm your intent.",
      ru: "COUNT(*) считает строки, а не уникальные значения — проверьте намерение.",
    },
    severity: "info",
  },
  {
    id: "unqualified_drop",
    message: {
      en: "DROP without schema qualifier relies on search_path — risky.",
      ru: "DROP без указания схемы зависит от search_path — рискованно.",
    },
    fix: {
      en: "Qualify the target as schema.name.",
      ru: "Укажите цель как schema.name.",
    },
    severity: "info",
  },
  {
    id: "bool_not_eq",
    message: {
      en: "Comparing a boolean with = true / <> false is verbose.",
      ru: "Сравнение булева значения с = true / <> false — избыточно.",
    },
    severity: "info",
  },
  {
    id: "type_cast_double_colon_spaces",
    message: {
      en: "Stylistic: prefer expr::type over expr :: type.",
      ru: "Стилистика: лучше expr::type, чем expr :: type.",
    },
    severity: "info",
  },
];
