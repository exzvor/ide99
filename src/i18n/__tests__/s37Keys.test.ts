/**
 * — i18n parity for paid-modules + updater + new settings tabs.
 */

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const KEYS = [
  // Paid modules
  "paid_modules.settings.title",
  "paid_modules.status.active",
  "paid_modules.status.inactive",
  "paid_modules.action.manage",
  "paid_modules.action.upgrade",
  "paid_modules.spg99.short_name",
  "paid_modules.spg99.full_name",
  "paid_modules.spg99.description",
  "paid_modules.spg99.cta_subscribed",
  "paid_modules.spg99.cta_upgrade",
  "paid_modules.spg99.status_bar",
  "paid_modules.vibepg.short_name",
  "paid_modules.vibepg.full_name",
  "paid_modules.vibepg.description",
  "paid_modules.vibepg.explain_optimize.label",
  "paid_modules.vibepg.migration_review.label",
  "paid_modules.vibepg.agent_mode.label",
  "paid_modules.vibepg.command_palette.label",
  // S37 () — vibepg slot extensions
  "paid_modules.vibepg.explain_optimize.full_label",
  "paid_modules.vibepg.migration_review.full_label",
  "paid_modules.vibepg.result_dialog.title",
  "paid_modules.vibepg.result_dialog.connecting",
  "paid_modules.vibepg.result_dialog.v1_1_note",
  "paid_modules.vibepg.result_dialog.iteration_log",
  "paid_modules.vibepg.result_dialog.field_tested",
  "paid_modules.vibepg.result_dialog.field_speedup",
  "paid_modules.vibepg.result_dialog.field_recommendation",
  "paid_modules.vibepg.result_dialog.recommendation_create",
  "paid_modules.vibepg.result_dialog.apply",
  "paid_modules.vibepg.result_dialog.cancel",
  "paid_modules.vibepg.agent_mode_toggle.aria_label",
  "paid_modules.vibepg.agent_mode_toggle.quick",
  "paid_modules.vibepg.agent_mode_toggle.agent",
  "paid_modules.vibepg.agent_mode_toggle.agent_locked_tooltip",
  "paid_modules.vibepg.command_palette_items.title",
  "paid_modules.vibepg.command_palette_items.search_placeholder",
  "paid_modules.vibepg.command_palette_items.no_results",
  "paid_modules.vibepg.command_palette_items.check_migration",
  "paid_modules.vibepg.command_palette_items.fix_sql_error",
  "paid_modules.vibepg.command_palette_items.explain_query",
  "paid_modules.vibepg.command_palette_items.suggest_index",
  "paid_modules.vibepg.command_palette_items.generate_seed_data",
  "paid_modules.vibepg.command_palette_items.compare_plans",
  "paid_modules.vibepg.command_palette_items.rollback_plan",
  "paid_modules.upgrade.spg99.cta",
  "paid_modules.upgrade.vibepg.cta",
  // Updater
  "updater.title",
  "updater.check_now",
  "updater.checking",
  "updater.current_version",
  "updater.up_to_date",
  "updater.available",
  "updater.error",
  "updater.error_unavailable",
  "updater.error_unreachable",
  "updater.channel.label",
  "updater.channel.stable",
  "updater.channel.beta",
  "updater.channel.nightly",
  // Settings tabs
  "settings.tabs.modules",
  "settings.tabs.updates",
] as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe("s37 i18n keys (baseline)", () => {
  for (const key of KEYS) {
    it(`en has ${key}`, () => {
      const v = get(en, key);
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    });
    it(`ru has ${key}`, () => {
      const v = get(ru, key);
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    });
  }
});
