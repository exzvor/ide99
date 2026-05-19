import { describe, expect, test } from "vitest";
import type { TableForm } from "../ddl/types";
import { formStateDirty } from "./formStateDirty";

function makeForm(): TableForm {
  return {
    schema: "public",
    name: "users",
    comment: null,
    columns: [
      {
        id: "00000000-0000-0000-0000-000000000001",
        name: "id",
        typeText: "BIGINT",
        nullable: false,
        default: null,
        generated: null,
        comment: null,
      },
    ],
    constraints: [],
    indexes: [],
    rls: { enabled: false, policies: [] },
    partition: null,
  };
}

describe("formStateDirty", () => {
  test("initial=null with any current state → dirty", () => {
    expect(formStateDirty(null, makeForm())).toBe(true);
    expect(formStateDirty(null, { foo: "bar" })).toBe(true);
  });

  test("identical objects (deep clone) → not dirty", () => {
    const a = makeForm();
    const b = JSON.parse(JSON.stringify(a)) as TableForm;
    expect(formStateDirty(a, b)).toBe(false);
  });

  test("modified column name → dirty", () => {
    const initial = makeForm();
    const current = makeForm();
    const firstCol = current.columns[0];
    if (firstCol) firstCol.name = "renamed";
    expect(formStateDirty(initial, current)).toBe(true);
  });

  test("reordered columns (cosmetic) → currently treated as dirty", () => {
    const initial = makeForm();
    initial.columns.push({
      id: "00000000-0000-0000-0000-000000000002",
      name: "email",
      typeText: "TEXT",
      nullable: false,
      default: null,
      generated: null,
      comment: null,
    });
    const current = makeForm();
    current.columns.push({
      id: "00000000-0000-0000-0000-000000000002",
      name: "email",
      typeText: "TEXT",
      nullable: false,
      default: null,
      generated: null,
      comment: null,
    });
    // Swap column order in current.
    current.columns.reverse();
    expect(formStateDirty(initial, current)).toBe(true);
  });

  test("added field (new column) → dirty", () => {
    const initial = makeForm();
    const current = makeForm();
    current.columns.push({
      id: "00000000-0000-0000-0000-000000000003",
      name: "created_at",
      typeText: "TIMESTAMPTZ",
      nullable: false,
      default: "now()",
      generated: null,
      comment: null,
    });
    expect(formStateDirty(initial, current)).toBe(true);
  });
});
