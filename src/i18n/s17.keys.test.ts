import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

const REQUIRED_S17_KEYS: string[] = [
  "jsonb.builder.title",
  "jsonb.builder.operatorLabel",
  "jsonb.builder.operator.existence",
  "jsonb.builder.operator.containment",
  "jsonb.builder.operator.pathExtract",
  "jsonb.builder.operator.pathPredicate",
  "jsonb.builder.pathLabel",
  "jsonb.builder.pathPlaceholder",
  "jsonb.builder.valueLabel",
  "jsonb.builder.extractMode.projection",
  "jsonb.builder.extractMode.comparison",
  "jsonb.builder.comparator.eq",
  "jsonb.builder.comparator.ne",
  "jsonb.builder.comparator.gt",
  "jsonb.builder.comparator.lt",
  "jsonb.builder.comparator.ge",
  "jsonb.builder.comparator.le",
  "jsonb.builder.comparator.likeRegex",
  "jsonb.builder.previewLabel",
  "jsonb.builder.warning.existenceTopLevel",
  "jsonb.builder.warning.pathTooDeep",
  "jsonb.builder.error.invalidJson",
  "jsonb.builder.error.typeMismatch",
  "jsonb.builder.actions.generate",
  "jsonb.builder.actions.cancel",
  "jsonb.builder.buildFromCellTitle",
  "jsonb.suggester.title",
  "jsonb.suggester.recommendedHeader",
  "jsonb.suggester.rationale.header",
  "jsonb.suggester.rationale.minedSummary",
  "jsonb.suggester.rationale.jsonbOpsBenefit",
  "jsonb.suggester.rationale.jsonbPathOpsBenefit",
  "jsonb.suggester.rationale.expressionBenefit",
  "jsonb.suggester.rationaleGeneric",
  "jsonb.suggester.sizeEstimateLabel",
  "jsonb.suggester.sizeEstimateValue",
  "jsonb.suggester.speedupLabel",
  "jsonb.suggester.speedupComputing",
  "jsonb.suggester.speedupComputed",
  "jsonb.suggester.speedupUnavailable.hypopgMissing",
  "jsonb.suggester.speedupUnavailable.hypopgInstallSql",
  "jsonb.suggester.speedupUnavailable.pgTooOld",
  "jsonb.suggester.speedupUnavailable.noRepresentativeQuery",
  "jsonb.suggester.speedupUnavailable.plannerError",
  "jsonb.suggester.representativeQueryLabel",
  "jsonb.suggester.actions.copy",
  "jsonb.suggester.actions.openInEditor",
  "jsonb.suggester.actions.close",
  "jsonb.suggester.actions.retry",
  "jsonb.suggester.actions.copied",
  "jsonb.suggester.extensions.pgStatStatementsRequiredCard",
  "jsonb.suggester.extensions.pgStatStatementsRequiredColumn",
  "schema.tree.menu.suggestGinIndex",
  "schema.tree.menu.buildJsonbQuery",
  "health.card.jsonb_index_suggestions.title",
  "health.card.jsonb_index_suggestions.row",
  "health.card.jsonb_index_suggestions.viewAction",
  "health.card.jsonb_index_suggestions.empty",
];

function lookup(obj: unknown, dottedKey: string): unknown {
  const parts = dottedKey.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || !(p in (cur as Record<string, unknown>))) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

describe("S17 i18n keys (EN canonical)", () => {
  for (const key of REQUIRED_S17_KEYS) {
    it(`has key ${key}`, () => {
      const value = lookup(en, key);
      expect(value, `missing key: ${key}`).toBeTypeOf("string");
      expect((value as string).length).toBeGreaterThan(0);
    });
  }
});

describe("S17 i18n keys (RU)", () => {
  for (const key of REQUIRED_S17_KEYS) {
    it(`has key ${key}`, () => {
      const value = lookup(ru, key);
      expect(value, `missing key in ru.json: ${key}`).toBeTypeOf("string");
      expect((value as string).length).toBeGreaterThan(0);
    });
  }
});
