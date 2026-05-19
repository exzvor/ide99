// — owner: .
import { describe, expect, test } from "vitest";

import { buildRepackCommand } from "../buildRepackCommand";

describe("buildRepackCommand", () => {
  test("emits the minimal command with only required fields", () => {
    const cmd = buildRepackCommand({
      host: "localhost",
      database: "mydb",
      schema: "public",
      table: "metrics",
    });
    expect(cmd).toBe("pg_repack -h localhost -d mydb -t public.metrics");
  });

  test("includes -p when port is provided", () => {
    const cmd = buildRepackCommand({
      host: "localhost",
      port: 6543,
      database: "mydb",
      schema: "public",
      table: "metrics",
    });
    expect(cmd).toBe("pg_repack -h localhost -p 6543 -d mydb -t public.metrics");
  });

  test("includes --jobs when jobs is provided", () => {
    const cmd = buildRepackCommand({
      host: "localhost",
      database: "mydb",
      schema: "public",
      table: "metrics",
      jobs: 4,
    });
    expect(cmd).toContain("--jobs 4");
  });

  test("appends --no-superuser-check when noSuperuserCheck is true", () => {
    const cmd = buildRepackCommand({
      host: "localhost",
      database: "mydb",
      schema: "public",
      table: "metrics",
      noSuperuserCheck: true,
    });
    expect(cmd).toContain("--no-superuser-check");
  });

  test("appends --only-indexes when onlyIndexes is true", () => {
    const cmd = buildRepackCommand({
      host: "localhost",
      database: "mydb",
      schema: "public",
      table: "metrics",
      onlyIndexes: true,
    });
    expect(cmd).toContain("--only-indexes");
  });

  test("emits all options together in deterministic order", () => {
    const cmd = buildRepackCommand({
      host: "db.example.com",
      port: 6543,
      database: "warehouse",
      schema: "analytics",
      table: "events",
      jobs: 2,
      noSuperuserCheck: true,
      onlyIndexes: true,
    });
    expect(cmd).toBe(
      "pg_repack -h db.example.com -p 6543 -d warehouse -t analytics.events --jobs 2 --no-superuser-check --only-indexes",
    );
  });

  test("omits flags when their toggles are false / undefined", () => {
    const cmd = buildRepackCommand({
      host: "localhost",
      database: "mydb",
      schema: "public",
      table: "metrics",
      noSuperuserCheck: false,
      onlyIndexes: false,
    });
    expect(cmd).not.toContain("--no-superuser-check");
    expect(cmd).not.toContain("--only-indexes");
    expect(cmd).not.toContain("--jobs");
    expect(cmd).not.toContain("-p");
  });
});
