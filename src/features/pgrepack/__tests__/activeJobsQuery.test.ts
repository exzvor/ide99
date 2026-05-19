// — owner: .
import { describe, expect, test } from "vitest";

import { ACTIVE_JOBS_SQL } from "../activeJobsQuery";

describe("ACTIVE_JOBS_SQL", () => {
  test("queries pg_stat_activity for active pg_repack backends", () => {
    // original query targeted `_repack.repack_log`, which
    // doesn't exist in pg_repack 1.5.3. Switched to pg_stat_activity
    // filtered by application_name — works across pg_repack versions.
    expect(ACTIVE_JOBS_SQL).toContain("pg_stat_activity");
    expect(ACTIVE_JOBS_SQL).toContain("application_name LIKE 'pg_repack%'");
    expect(ACTIVE_JOBS_SQL).toContain("ORDER BY backend_start DESC");
    expect(ACTIVE_JOBS_SQL).not.toContain("_repack.repack_log");
  });
});
