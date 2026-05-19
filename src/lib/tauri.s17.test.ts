import { describe, expect, it } from "vitest";

import { builderPreviewSchema, hypoPgEstimateSchema, suggesterResultSchema } from "./tauri";

describe("S17 zod schemas", () => {
  it("parses BuilderPreview", () => {
    const wire = {
      sql: "SELECT 1",
      warnings: [{ kind: "existenceTopLevel" }],
    };
    const parsed = builderPreviewSchema.parse(wire);
    expect(parsed.sql).toBe("SELECT 1");
    expect(parsed.warnings[0]).toEqual({ kind: "existenceTopLevel" });
  });

  it("parses SuggesterResult with mined rationale", () => {
    const wire = {
      extensions: {
        pgStatStatements: { kind: "available" },
        hypopg: { kind: "unavailable", installSql: "CREATE EXTENSION hypopg;" },
        genericPlan: true,
      },
      suggestions: [
        {
          schema: "public",
          table: "events",
          column: "data",
          opClass: { kind: "jsonbPathOps" },
          recommendedSql: "CREATE INDEX …",
          indexName: "idx_events_data_gin",
          rationale: {
            kind: "mined",
            calls: 1234,
            totalExecTimeMs: 8400.0,
            opsSeen: ["@>", "@?"],
          },
          estimatedSizeBytes: 85_000_000,
          representativeQuery: "SELECT * FROM events WHERE data @> $1",
        },
      ],
      generatedAt: 1_714_300_000_000,
    };
    const parsed = suggesterResultSchema.parse(wire);
    expect(parsed.suggestions).toHaveLength(1);
  });

  it("parses HypoPgEstimate computed and unavailable variants", () => {
    expect(
      hypoPgEstimateSchema.parse({
        kind: "computed",
        baselineCost: 12450,
        hypotheticalCost: 380,
        reductionPct: 96.95,
      }).kind,
    ).toBe("computed");

    expect(
      hypoPgEstimateSchema.parse({
        kind: "unavailable",
        reason: { kind: "extensionMissing" },
      }).kind,
    ).toBe("unavailable");
  });
});
