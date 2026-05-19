import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

const REQUIRED_S19_KEYS: string[] = [
  "erd.edit.toggle.label",
  "erd.edit.toggle.tooltip",
  "erd.edit.new_table",
  "erd.edit.add_column",
  "erd.edit.apply",
  "erd.edit.discard",
  "erd.edit.cancel",
  "erd.edit.undo",
  "erd.edit.redo",
  "erd.edit.reset_layout",
  "erd.edit.preview.title",
  "erd.edit.preview.statement_count",
  "erd.edit.preview.empty",
  "erd.edit.preview.warning_count",
  "erd.edit.preview.error.title",
  "erd.edit.confirm.apply.title",
  "erd.edit.confirm.apply.body",
  "erd.edit.confirm.discard.title",
  "erd.edit.confirm.discard.body",
  "erd.edit.confirm.reset_layout",
  "erd.edit.fk.modal.title",
  "erd.edit.fk.modal.from",
  "erd.edit.fk.modal.to",
  "erd.edit.fk.modal.constraint_name",
  "erd.edit.fk.modal.add",
  "erd.edit.fk.modal.not_pk_unique",
  "erd.edit.validation.empty_name",
  "erd.edit.validation.duplicate_table",
  "erd.edit.validation.duplicate_column",
  "erd.edit.validation.fk_type_mismatch",
  "erd.edit.validation.fk_target_not_unique",
  "erd.edit.validation.no_columns",
  "erd.edit.toast.apply_success",
];

function pluck(obj: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined,
      obj,
    );
}

describe("i18n keys", () => {
  it("has all required keys in en.json", () => {
    for (const key of REQUIRED_S19_KEYS) {
      expect(pluck(en, key), `missing en key: ${key}`).toBeTypeOf("string");
    }
  });
  it("has all required keys in ru.json", () => {
    for (const key of REQUIRED_S19_KEYS) {
      expect(pluck(ru, key), `missing ru key: ${key}`).toBeTypeOf("string");
    }
  });
  it("en/ru have same key set under erd.edit", () => {
    type ErdEditMap = Record<string, unknown>;
    const enKeys = JSON.stringify(
      Object.keys(((en as Record<string, ErdEditMap>).erd as ErdEditMap).edit as ErdEditMap).sort(),
    );
    const ruKeys = JSON.stringify(
      Object.keys(((ru as Record<string, ErdEditMap>).erd as ErdEditMap).edit as ErdEditMap).sort(),
    );
    expect(enKeys).toBe(ruKeys);
  });
});
