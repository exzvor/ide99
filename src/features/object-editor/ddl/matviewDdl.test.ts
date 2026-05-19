import { describe, expect, test } from "vitest";
import { generateMatviewDdl } from "./matviewDdl";
import type { MatviewForm } from "./types";

const baseMv = (over: Partial<MatviewForm> = {}): MatviewForm => ({
  schema: "public",
  name: "agg_mv",
  body: "SELECT count(*) FROM events",
  withData: true,
  ...over,
});

describe("generateMatviewDdl", () => {
  test("create-mode WITH DATA", () => {
    const result = generateMatviewDdl(null, baseMv());
    expect(result.sql).toBe(
      "CREATE MATERIALIZED VIEW public.agg_mv AS\nSELECT count(*) FROM events\nWITH DATA;",
    );
  });

  test("create-mode WITH NO DATA", () => {
    const result = generateMatviewDdl(null, baseMv({ withData: false }));
    expect(result.sql).toBe(
      "CREATE MATERIALIZED VIEW public.agg_mv AS\nSELECT count(*) FROM events\nWITH NO DATA;",
    );
  });

  test("edit-mode body change → DROP + CREATE + warning", () => {
    const initial = baseMv();
    const current = baseMv({ body: "SELECT count(DISTINCT user_id) FROM events" });
    const result = generateMatviewDdl(initial, current);
    expect(result.warnings.find((w) => w.code === "matview_recreate")).toBeTruthy();
    expect(result.sql).toBe(
      [
        "DROP MATERIALIZED VIEW IF EXISTS public.agg_mv;",
        "CREATE MATERIALIZED VIEW public.agg_mv AS",
        "SELECT count(DISTINCT user_id) FROM events",
        "WITH DATA;",
      ].join("\n"),
    );
  });

  test("edit-mode withData toggle (body unchanged) → REFRESH", () => {
    const initial = baseMv({ withData: true });
    const current = baseMv({ withData: false });
    const result = generateMatviewDdl(initial, current);
    expect(result.warnings).toEqual([]);
    expect(result.sql).toBe("REFRESH MATERIALIZED VIEW public.agg_mv WITH NO DATA;");
  });
});
