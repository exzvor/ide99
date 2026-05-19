import { describe, expect, it } from "vitest";
import { computeInsights } from "./insights";

// ---------- helpers ----------

/** Wrap a single Plan node into the pev2 root shape `[{ Plan: <node> }]`. */
const wrap = (plan: Record<string, unknown>): unknown[] => [{ Plan: plan }];

/** Return a shallow copy of the node with the given keys omitted. */
const omit = (node: Record<string, unknown>, ...keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
};

// ---------- fixture builders ----------

interface SeqScanArgs {
  rel?: string;
  schema?: string;
  alias?: string;
  filter?: string;
  actualRows?: number;
  planRows?: number;
}

const seqScan = ({
  rel = "users",
  schema = "public",
  alias,
  filter = "status = 'active'",
  actualRows = 5_000_000,
  // Default Plan Rows close to Actual Rows so the R4 stale-stats rule does
  // NOT fire incidentally — these fixtures are about R1 in isolation.
  planRows = 4_500_000,
}: SeqScanArgs = {}): Record<string, unknown> => {
  const node: Record<string, unknown> = {
    "Node Type": "Seq Scan",
    "Relation Name": rel,
    Schema: schema,
    "Plan Rows": planRows,
    "Actual Rows": actualRows,
    "Total Cost": 12345.67,
  };
  if (alias !== undefined) node.Alias = alias;
  if (filter !== undefined) node.Filter = filter;
  return node;
};

const hashJoinWithDisk = (diskUsage: number): Record<string, unknown> => ({
  "Node Type": "Hash Join",
  "Total Cost": 9999,
  "Plan Rows": 1000,
  "Actual Rows": 1500,
  Plans: [
    {
      "Node Type": "Seq Scan",
      "Relation Name": "orders",
      Schema: "public",
      "Plan Rows": 1500,
      "Actual Rows": 1500,
    },
    {
      "Node Type": "Hash",
      "Disk Usage": diskUsage,
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "customers",
          Schema: "public",
          "Plan Rows": 1500,
          "Actual Rows": 1500,
        },
      ],
    },
  ],
});

interface NestedLoopArgs {
  loops: number;
  innerRel?: string;
  innerSchema?: string;
  innerCond?: string;
}

const nestedLoop = ({
  loops,
  innerRel = "logs",
  innerSchema = "public",
  innerCond = "user_id = u.id",
}: NestedLoopArgs): Record<string, unknown> => ({
  "Node Type": "Nested Loop",
  "Actual Loops": 1,
  "Total Cost": 1000,
  Plans: [
    {
      "Node Type": "Seq Scan",
      "Relation Name": "users",
      Schema: "public",
      Alias: "u",
      "Plan Rows": loops,
      "Actual Rows": loops,
      "Actual Loops": 1,
    },
    {
      "Node Type": "Index Scan",
      "Relation Name": innerRel,
      Schema: innerSchema,
      "Index Cond": innerCond,
      "Plan Rows": 1,
      "Actual Rows": 1,
      "Actual Loops": loops,
    },
  ],
});

// ---------- R1: Seq Scan large ----------

describe("R1_seq_scan_large", () => {
  it("fires on Seq Scan with >1M actual rows and a Filter", () => {
    const plan = wrap(seqScan({ actualRows: 5_000_000, filter: "status = 'active'" }));
    const insights = computeInsights(plan);

    const r1 = insights.find((i) => i.ruleId === "R1_seq_scan_large");
    expect(r1).toBeDefined();
    expect(r1?.severity).toBe("high");
    expect(r1?.nodePath).toEqual([0]);
    expect(r1?.titleKey).toBe("editor.explain.insights.rule.r1.title");
    expect(r1?.bodyKey).toBe("editor.explain.insights.rule.r1.body");
    expect(r1?.bodyParams).toMatchObject({
      column: "status",
      rows: 5_000_000,
    });
    expect(r1?.suggestedSql).toContain("-- Suggested by ide99 (rule R1)");
    expect(r1?.suggestedSql).toContain(      "CREATE INDEX CONCURRENTLY idx_users_status ON public.users (status);",
);
    expect(r1?.nodeLabel).toBe("Seq Scan on public.users");
  });

  it("does NOT fire when row count is at/under threshold", () => {
    const plan = wrap(seqScan({ actualRows: 1_000_000 })); // exactly 1M, NOT > 1M
    expect(computeInsights(plan)).toEqual([]);
  });

  it("does NOT fire when there is no Filter (full-table scan, indexing won't help)", () => {
    const node = omit(seqScan({ actualRows: 5_000_000 }), "Filter");
    expect(computeInsights(wrap(node))).toEqual([]);
  });

  it("falls back to Plan Rows when Actual Rows is missing (no ANALYZE)", () => {
    const node = omit(seqScan({ planRows: 5_000_000 }), "Actual Rows");
    const insights = computeInsights(wrap(node));
    const r1 = insights.find((i) => i.ruleId === "R1_seq_scan_large");
    expect(r1).toBeDefined();
    // No R3, R4 because they need Actual Rows / Loops.
    expect(insights.filter((i) => i.ruleId === "R3_nested_loop_hot")).toHaveLength(0);
    expect(insights.filter((i) => i.ruleId === "R4_stale_stats")).toHaveLength(0);
  });

  it("includes the alias in the nodeLabel when alias differs from relation", () => {
    const plan = wrap(seqScan({ alias: "u" }));
    const insights = computeInsights(plan);
    const r1 = insights.find((i) => i.ruleId === "R1_seq_scan_large");
    expect(r1?.nodeLabel).toBe("Seq Scan on public.users (u)");
  });

  it("omits the alias suffix when alias === relation name", () => {
    const plan = wrap(seqScan({ alias: "users" }));
    const insights = computeInsights(plan);
    const r1 = insights.find((i) => i.ruleId === "R1_seq_scan_large");
    expect(r1?.nodeLabel).toBe("Seq Scan on public.users");
  });

  it("drops the schema prefix when Schema is absent", () => {
    const node = omit(seqScan({ schema: undefined }), "Schema");
    const r1 = computeInsights(wrap(node)).find((i) => i.ruleId === "R1_seq_scan_large");
    expect(r1?.nodeLabel).toBe("Seq Scan on users");
    // Schema defaults to "public" in suggested SQL.
    expect(r1?.suggestedSql).toContain("ON public.users (status);");
  });
});

describe("R1 column extraction (Filter parsing)", () => {
  it("parses simple `<col> = const` form", () => {
    const r1 = computeInsights(wrap(seqScan({ filter: "status = 'active'" }))).find(      (i) => i.ruleId === "R1_seq_scan_large",
);
    expect(r1?.bodyParams.column).toBe("status");
  });

  it("parses parenthesised filter `(created_at > now() - interval '1 day')`", () => {
    const r1 = computeInsights(      wrap(seqScan({ filter: "(created_at > now() - interval '1 day')" })),
).find((i) => i.ruleId === "R1_seq_scan_large");
    expect(r1?.bodyParams.column).toBe("created_at");
  });

  it("parses `<col> >= const` form", () => {
    const r1 = computeInsights(wrap(seqScan({ filter: "id >= 100" }))).find(      (i) => i.ruleId === "R1_seq_scan_large",
);
    expect(r1?.bodyParams.column).toBe("id");
  });

  it("parses `<col> IS NULL`", () => {
    const r1 = computeInsights(wrap(seqScan({ filter: "deleted_at IS NULL" }))).find(      (i) => i.ruleId === "R1_seq_scan_large",
);
    expect(r1?.bodyParams.column).toBe("deleted_at");
  });

  it("falls back to placeholder `col` for cast-wrapped filter `((status)::text = 'a'::text)`", () => {
    // Documented behaviour: regex captures the leftmost bare `<word> <op>` pair
    // at the start (after optional parens). A cast-wrapped column does NOT
    // match — emit literal "col" placeholder, both in bodyParams and SQL.
    const r1 = computeInsights(wrap(seqScan({ filter: "((status)::text = 'a'::text)" }))).find(      (i) => i.ruleId === "R1_seq_scan_large",
);
    expect(r1?.bodyParams.column).toBe("col");
    expect(r1?.suggestedSql).toContain("idx_users_col");
    expect(r1?.suggestedSql).toContain("(col)");
  });

  it("falls back to `col` placeholder for completely opaque filters", () => {
    const r1 = computeInsights(wrap(seqScan({ filter: "(now() - interval '1 day') > 0" }))).find(      (i) => i.ruleId === "R1_seq_scan_large",
);
    // No leftmost identifier-then-operator match → placeholder.
    expect(r1?.bodyParams.column).toBe("col");
  });
});

// ---------- R2: Hash Join spilled to disk ----------

describe("R2_hash_join_disk", () => {
  it("fires on Hash Join with descendant Hash node having Disk Usage > 0", () => {
    const insights = computeInsights(wrap(hashJoinWithDisk(2048)));
    const r2 = insights.find((i) => i.ruleId === "R2_hash_join_disk");
    expect(r2).toBeDefined();
    expect(r2?.severity).toBe("med");
    expect(r2?.titleKey).toBe("editor.explain.insights.rule.r2.title");
    expect(r2?.bodyKey).toBe("editor.explain.insights.rule.r2.body");
    expect(r2?.nodePath).toEqual([0]);
    expect(r2?.suggestedSql).toContain("-- Suggested by ide99 (rule R2)");
    expect(r2?.suggestedSql).toContain("SET work_mem = '64MB';");
    expect(r2?.suggestedSql).toContain(      "-- Or build an index on the join key so planner picks Merge Join.",
);
  });

  it("formats Disk Usage as kB when below 1024", () => {
    const insights = computeInsights(wrap(hashJoinWithDisk(12)));
    const r2 = insights.find((i) => i.ruleId === "R2_hash_join_disk");
    expect(r2?.bodyParams.disk).toBe("12 kB");
  });

  it("formats Disk Usage as MB with 1 decimal when >= 1024", () => {
    // 1536 kB = 1.5 MB
    const insights = computeInsights(wrap(hashJoinWithDisk(1536)));
    const r2 = insights.find((i) => i.ruleId === "R2_hash_join_disk");
    expect(r2?.bodyParams.disk).toBe("1.5 MB");
  });

  it("does NOT fire when Disk Usage is 0", () => {
    expect(      computeInsights(wrap(hashJoinWithDisk(0))).filter((i) => i.ruleId === "R2_hash_join_disk"),
).toHaveLength(0);
  });

  it("does NOT fire when there is no descendant Hash node with Disk Usage", () => {
    const plan = wrap({
      "Node Type": "Hash Join",
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "a", Schema: "public" },
        { "Node Type": "Hash" }, // no Disk Usage
      ],
    });
    expect(computeInsights(plan)).toEqual([]);
  });
});

// ---------- R3: Hot Nested Loop ----------

describe("R3_nested_loop_hot", () => {
  it("fires on Nested Loop with Actual Loops > 10_000 and uses inner side's relation", () => {
    const plan = wrap(      nestedLoop({ loops: 50_000, innerRel: "b", innerSchema: "public", innerCond: "x = 5" }),
);
    // Bump the outer Nested Loop's Actual Loops directly to make threshold check explicit.
    const planRoot = plan[0] as { Plan: Record<string, unknown> };
    planRoot.Plan["Actual Loops"] = 50_000;
    const insights = computeInsights(plan);
    const r3 = insights.find((i) => i.ruleId === "R3_nested_loop_hot");
    expect(r3).toBeDefined();
    expect(r3?.severity).toBe("high");
    expect(r3?.titleKey).toBe("editor.explain.insights.rule.r3.title");
    expect(r3?.bodyKey).toBe("editor.explain.insights.rule.r3.body");
    expect(r3?.bodyParams).toMatchObject({ innerRel: "b", loops: 50_000, column: "x" });
    expect(r3?.suggestedSql).toContain("-- Suggested by ide99 (rule R3)");
    expect(r3?.suggestedSql).toContain("CREATE INDEX CONCURRENTLY idx_b_x ON public.b (x);");
  });

  it("does NOT fire when Actual Loops is at/under threshold", () => {
    const plan = wrap(nestedLoop({ loops: 5000 }));
    const planRoot = plan[0] as { Plan: Record<string, unknown> };
    planRoot.Plan["Actual Loops"] = 5000;
    expect(computeInsights(plan).filter((i) => i.ruleId === "R3_nested_loop_hot")).toHaveLength(0);
  });

  it("does NOT fire when Actual Loops is missing (no ANALYZE)", () => {
    const plan: Record<string, unknown> = {
      "Node Type": "Nested Loop",
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "a", Schema: "public" },
        { "Node Type": "Index Scan", "Relation Name": "b", Schema: "public" },
      ],
    };
    expect(computeInsights(wrap(plan)).filter((i) => i.ruleId === "R3_nested_loop_hot")).toEqual(      [],
);
  });

  it("uses 'col' placeholder when no Index Cond / Filter / Hash Cond on inner side", () => {
    const plan: Record<string, unknown> = {
      "Node Type": "Nested Loop",
      "Actual Loops": 50_000,
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "a", Schema: "public" },
        { "Node Type": "Index Scan", "Relation Name": "b", Schema: "public" },
      ],
    };
    const r3 = computeInsights(wrap(plan)).find((i) => i.ruleId === "R3_nested_loop_hot");
    expect(r3?.bodyParams.column).toBe("col");
    expect(r3?.suggestedSql).toContain("idx_b_col");
    expect(r3?.suggestedSql).toContain("(col)");
  });

  it("scans children for first with Relation Name when children[1] lacks one", () => {
    // Inner side is a Materialize wrapping the actual Index Scan with relation b.
    const plan: Record<string, unknown> = {
      "Node Type": "Nested Loop",
      "Actual Loops": 50_000,
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "a", Schema: "public" },
        {
          "Node Type": "Materialize",
          Plans: [
            {
              "Node Type": "Index Scan",
              "Relation Name": "b",
              Schema: "public",
              "Index Cond": "id = a.id",
            },
          ],
        },
      ],
    };
    const r3 = computeInsights(wrap(plan)).find((i) => i.ruleId === "R3_nested_loop_hot");
    expect(r3).toBeDefined();
    expect(r3?.bodyParams.innerRel).toBe("b");
    expect(r3?.suggestedSql).toContain("ON public.b");
  });
});

// ---------- R4: Stale stats ----------

describe("R4_stale_stats", () => {
  it("fires when Actual Rows is >=10x Plan Rows on a relation-bearing node", () => {
    const plan = wrap({
      "Node Type": "Index Scan",
      "Relation Name": "events",
      Schema: "public",
      "Plan Rows": 10,
      "Actual Rows": 500,
    });
    const r4 = computeInsights(plan).find((i) => i.ruleId === "R4_stale_stats");
    expect(r4).toBeDefined();
    expect(r4?.severity).toBe("med");
    expect(r4?.titleKey).toBe("editor.explain.insights.rule.r4.title");
    expect(r4?.bodyKey).toBe("editor.explain.insights.rule.r4.body");
    expect(r4?.bodyParams).toMatchObject({
      relation: "events",
      estRows: 10,
      actualRows: 500,
      ratio: 50,
    });
    expect(r4?.suggestedSql).toContain("-- Suggested by ide99 (rule R4)");
    expect(r4?.suggestedSql).toContain("ANALYZE public.events;");
  });

  it("fires when Plan Rows >= 10x Actual Rows (over-estimate)", () => {
    const plan = wrap({
      "Node Type": "Index Scan",
      "Relation Name": "events",
      Schema: "public",
      "Plan Rows": 10_000,
      "Actual Rows": 100,
    });
    const r4 = computeInsights(plan).find((i) => i.ruleId === "R4_stale_stats");
    expect(r4).toBeDefined();
    expect(r4?.bodyParams.ratio).toBe(100);
  });

  it("does NOT fire when Actual Rows < 100", () => {
    const plan = wrap({
      "Node Type": "Index Scan",
      "Relation Name": "events",
      Schema: "public",
      "Plan Rows": 1,
      "Actual Rows": 99,
    });
    expect(computeInsights(plan).filter((i) => i.ruleId === "R4_stale_stats")).toEqual([]);
  });

  it("does NOT fire when ratio < 10", () => {
    const plan = wrap({
      "Node Type": "Index Scan",
      "Relation Name": "events",
      Schema: "public",
      "Plan Rows": 100,
      "Actual Rows": 500,
    });
    expect(computeInsights(plan).filter((i) => i.ruleId === "R4_stale_stats")).toEqual([]);
  });

  it("does NOT fire when Actual Rows is missing (no ANALYZE)", () => {
    const plan = wrap({
      "Node Type": "Index Scan",
      "Relation Name": "events",
      Schema: "public",
      "Plan Rows": 1_000,
    });
    expect(computeInsights(plan).filter((i) => i.ruleId === "R4_stale_stats")).toEqual([]);
  });

  it("dedupes by Relation Name across multiple matching nodes (one card per relation)", () => {
    // Tree with three references to public.users that all trigger R4.
    const plan = wrap({
      "Node Type": "Append",
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "users",
          Schema: "public",
          "Plan Rows": 1,
          "Actual Rows": 1000,
        },
        {
          "Node Type": "Index Scan",
          "Relation Name": "users",
          Schema: "public",
          "Plan Rows": 1,
          "Actual Rows": 500,
        },
        {
          "Node Type": "Bitmap Heap Scan",
          "Relation Name": "users",
          Schema: "public",
          "Plan Rows": 1,
          "Actual Rows": 200,
        },
      ],
    });
    const r4s = computeInsights(plan).filter((i) => i.ruleId === "R4_stale_stats");
    expect(r4s).toHaveLength(1);
    // Points to first match in DFS order (the Seq Scan child at [0, 0]).
    expect(r4s[0].nodePath).toEqual([0, 0]);
    expect(r4s[0].bodyParams.actualRows).toBe(1000);
  });
});

// ---------- Multi-rule + sorting ----------

describe("multi-rule + sorting", () => {
  it("fires both R1 (high) and R4 (med) on the same Seq Scan; R1 first", () => {
    // Seq Scan with 5M actual rows AND Plan Rows way off (estimate 1, actual 5M).
    const plan = wrap({
      "Node Type": "Seq Scan",
      "Relation Name": "users",
      Schema: "public",
      "Plan Rows": 1,
      "Actual Rows": 5_000_000,
      Filter: "status = 'active'",
    });
    const insights = computeInsights(plan);
    expect(insights).toHaveLength(2);
    expect(insights[0].ruleId).toBe("R1_seq_scan_large"); // high
    expect(insights[1].ruleId).toBe("R4_stale_stats"); // med
    expect(insights[0].nodePath).toEqual([0]);
    expect(insights[1].nodePath).toEqual([0]);
  });

  it("sorts by severity DESC then nodePath lexicographically", () => {
    // Build a tree with: R3 high at [0], R4 med at [0,0,0] (deep), R1 high at [0,1].
    // Expected order:
    // R3 (high, [0])  →  R1 (high, [0,1])  →  R4 (med, [0,0,0]).
    const plan = wrap({
      "Node Type": "Nested Loop",
      "Actual Loops": 50_000,
      Plans: [
        {
          "Node Type": "Sort",
          Plans: [
            {
              // R4 candidate at [0,0,0]
              "Node Type": "Seq Scan",
              "Relation Name": "events",
              Schema: "public",
              "Plan Rows": 1,
              "Actual Rows": 500,
            },
          ],
        },
        // R1 candidate at [0,1] — Plan Rows close to Actual so R4 doesn't
        // also fire on "users" (this test isolates the sort, not multi-rule).
        {
          "Node Type": "Seq Scan",
          "Relation Name": "users",
          Schema: "public",
          "Plan Rows": 4_500_000,
          "Actual Rows": 5_000_000,
          Filter: "status = 'active'",
        },
      ],
    });
    const insights = computeInsights(plan);
    const ids = insights.map((i) => i.ruleId);
    // R3 root (path [0]) and R1 (path [0,1]) are both high; R3 sorts first
    // because [0] < [0,1] (shorter wins on prefix tie). R4 is med, last.
    expect(ids).toEqual(["R3_nested_loop_hot", "R1_seq_scan_large", "R4_stale_stats"]);
  });

  it("emits only R1 when plan has no ANALYZE data (Actual Rows / Loops absent)", () => {
    const plan = wrap({
      "Node Type": "Seq Scan",
      "Relation Name": "users",
      Schema: "public",
      "Plan Rows": 5_000_000, // R1 falls back to Plan Rows
      Filter: "status = 'active'",
    });
    const insights = computeInsights(plan);
    expect(insights.map((i) => i.ruleId)).toEqual(["R1_seq_scan_large"]);
  });
});

// ---------- nodePath assertions on a 3-level tree ----------

describe("nodePath", () => {
  it("addresses a leaf in a 3-level tree as [0, 1, 0]", () => {
    const plan = wrap({
      "Node Type": "Hash Join",
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "a", Schema: "public" },
        {
          "Node Type": "Hash",
          "Disk Usage": 100,
          Plans: [
            // R4 candidate sits here at path [0, 1, 0]
            {
              "Node Type": "Seq Scan",
              "Relation Name": "users",
              Schema: "public",
              "Plan Rows": 1,
              "Actual Rows": 500,
            },
          ],
        },
      ],
    });
    const insights = computeInsights(plan);
    const r4 = insights.find((i) => i.ruleId === "R4_stale_stats");
    expect(r4?.nodePath).toEqual([0, 1, 0]);
    const r2 = insights.find((i) => i.ruleId === "R2_hash_join_disk");
    expect(r2?.nodePath).toEqual([0]);
  });
});

// ---------- walker stability ----------

describe("walker stability", () => {
  it("returns identical output (deep equal) for the same input twice", () => {
    const plan = wrap({
      "Node Type": "Hash Join",
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "a", Schema: "public" },
        {
          "Node Type": "Hash",
          "Disk Usage": 4096,
          Plans: [
            {
              "Node Type": "Seq Scan",
              "Relation Name": "users",
              Schema: "public",
              "Plan Rows": 1,
              "Actual Rows": 5_000_000,
              Filter: "status = 'active'",
            },
          ],
        },
      ],
    });
    const out1 = computeInsights(plan);
    const out2 = computeInsights(plan);
    expect(out1).toEqual(out2);
    expect(out1.map((i) => i.ruleId)).toEqual(out2.map((i) => i.ruleId));
  });
});

// ---------- malformed input ----------

describe("malformed input", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty array", []],
    ["plain object", {}],
    ["array with no Plan", [{ no_plan: true }]],
    ["array with non-object Plan", [{ Plan: 42 }]],
    ["string", "not a plan"],
    ["number", 7],
  ])("returns [] for %s input", (_label, input) => {
    expect(computeInsights(input)).toEqual([]);
  });
});
