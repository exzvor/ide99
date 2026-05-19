import { describe, expect, test } from "vitest";
import type { ViewForm } from "./types";
import { generateViewDdl } from "./viewDdl";

const baseView = (over: Partial<ViewForm> = {}): ViewForm => ({
  schema: "public",
  name: "user_view",
  body: "SELECT id, email FROM users",
  ...over,
});

describe("generateViewDdl", () => {
  test("create-mode → CREATE OR REPLACE VIEW", () => {
    const result = generateViewDdl(null, baseView());
    expect(result.sql).toBe(      "CREATE OR REPLACE VIEW public.user_view AS\nSELECT id, email FROM users;",
);
  });

  test("edit-mode body change → CREATE OR REPLACE", () => {
    const initial = baseView();
    const current = baseView({ body: "SELECT id, email, name FROM users" });
    const result = generateViewDdl(initial, current);
    expect(result.sql).toBe(      "CREATE OR REPLACE VIEW public.user_view AS\nSELECT id, email, name FROM users;",
);
  });

  test("rename-only → ALTER VIEW … RENAME TO precedes CREATE OR REPLACE", () => {
    const initial = baseView({ name: "old_v" });
    const current = baseView({ name: "new_v" });
    const result = generateViewDdl(initial, current);
    expect(result.sql).toBe(      "ALTER VIEW public.old_v RENAME TO new_v;\nCREATE OR REPLACE VIEW public.new_v AS\nSELECT id, email FROM users;",
);
  });

  test("no diff → empty sql", () => {
    const v = baseView();
    const result = generateViewDdl(v, { ...v });
    expect(result.sql).toBe("");
  });
});
