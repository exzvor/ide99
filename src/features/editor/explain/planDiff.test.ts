import { describe, expect, it } from "vitest";
import { type MatchedNode, type PlanDiff, diffPlans } from "./planDiff";

/** Find-or-fail helper — narrows the type while keeping linter happy. */
function mustFind<T>(arr: T[], pred: (x: T) => boolean, msg: string): T {
  const hit = arr.find(pred);
  if (!hit) throw new Error(`mustFind failed: ${msg}`);
  return hit;
}

/* ------------------------------------------------------------------ *
 * Plan-JSON fixtures (top-level array as Postgres EXPLAIN (FORMAT JSON))
 * ------------------------------------------------------------------ */

// Simple Sort → Seq Scan on public.users
const SIMPLE_PLAN = [
  {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 100.5,
      "Actual Total Time": 12.3,
      "Plan Rows": 1000,
      "Actual Rows": 950,
      Plans: [
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "users",
          Alias: "users",
          "Total Cost": 80.0,
          "Actual Total Time": 10.1,
          "Plan Rows": 1000,
          "Actual Rows": 950,
        },
      ],
    },
  },
];

// Same shape but inner Seq Scan replaced with Index Scan on the same relation
const INDEX_PLAN = [
  {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 30.0,
      "Actual Total Time": 4.0,
      "Plan Rows": 1000,
      "Actual Rows": 950,
      Plans: [
        {
          "Node Type": "Index Scan",
          Schema: "public",
          "Relation Name": "users",
          Alias: "users",
          "Total Cost": 20.0,
          "Actual Total Time": 3.5,
          "Plan Rows": 1000,
          "Actual Rows": 950,
        },
      ],
    },
  },
];

// Same structure as SIMPLE_PLAN but stale stats (different rows; same costs)
const STALE_PLAN = [
  {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 100.5,
      "Actual Total Time": 12.3,
      "Plan Rows": 100,
      "Actual Rows": 9500,
      Plans: [
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "users",
          Alias: "users",
          "Total Cost": 80.0,
          "Actual Total Time": 10.1,
          "Plan Rows": 100,
          "Actual Rows": 9500,
        },
      ],
    },
  },
];

// Hash Join with [Seq Scan a, Seq Scan b] children
const JOIN_LEFT = [
  {
    Plan: {
      "Node Type": "Hash Join",
      "Total Cost": 200.0,
      "Actual Total Time": 20.0,
      Plans: [
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "a",
          Alias: "a",
          "Total Cost": 50.0,
          "Actual Total Time": 5.0,
        },
        {
          "Node Type": "Hash",
          "Total Cost": 60.0,
          "Actual Total Time": 6.0,
          Plans: [
            {
              "Node Type": "Seq Scan",
              Schema: "public",
              "Relation Name": "b",
              Alias: "b",
              "Total Cost": 55.0,
              "Actual Total Time": 5.5,
            },
          ],
        },
      ],
    },
  },
];

// Same Hash Join, but children swapped: [Seq Scan b inside Hash, Seq Scan a]
const JOIN_RIGHT_REORDERED = [
  {
    Plan: {
      "Node Type": "Hash Join",
      "Total Cost": 200.0,
      "Actual Total Time": 20.0,
      Plans: [
        {
          "Node Type": "Hash",
          "Total Cost": 60.0,
          "Actual Total Time": 6.0,
          Plans: [
            {
              "Node Type": "Seq Scan",
              Schema: "public",
              "Relation Name": "b",
              Alias: "b",
              "Total Cost": 55.0,
              "Actual Total Time": 5.5,
            },
          ],
        },
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "a",
          Alias: "a",
          "Total Cost": 50.0,
          "Actual Total Time": 5.0,
        },
      ],
    },
  },
];

// Disjoint plan: completely different relations
const DISJOINT_PLAN = [
  {
    Plan: {
      "Node Type": "Aggregate",
      "Total Cost": 500.0,
      Plans: [
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "orders",
          Alias: "orders",
          "Total Cost": 400.0,
        },
      ],
    },
  },
];

// Self-join: users u1 JOIN users u2
const SELF_JOIN_PLAN = [
  {
    Plan: {
      "Node Type": "Nested Loop",
      "Total Cost": 300.0,
      "Actual Total Time": 30.0,
      Plans: [
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "users",
          Alias: "u1",
          "Total Cost": 100.0,
          "Actual Total Time": 10.0,
        },
        {
          "Node Type": "Index Scan",
          Schema: "public",
          "Relation Name": "users",
          Alias: "u2",
          "Total Cost": 150.0,
          "Actual Total Time": 18.0,
        },
      ],
    },
  },
];

// No-ANALYZE variant of SIMPLE_PLAN (no Actual Total Time / Actual Rows)
const NO_ANALYZE_PLAN = [
  {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 100.5,
      "Plan Rows": 1000,
      Plans: [
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "users",
          Alias: "users",
          "Total Cost": 80.0,
          "Plan Rows": 1000,
        },
      ],
    },
  },
];

// Plan engineered to exercise the matched-sort: two type-changes with different
// cost magnitudes plus a same-type match.
const SORT_LEFT = [
  {
    Plan: {
      "Node Type": "Aggregate",
      "Total Cost": 1000.0,
      Plans: [
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "small",
          Alias: "small",
          "Total Cost": 10.0,
        },
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "big",
          Alias: "big",
          "Total Cost": 900.0,
        },
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "same",
          Alias: "same",
          "Total Cost": 50.0,
        },
      ],
    },
  },
];

const SORT_RIGHT = [
  {
    Plan: {
      "Node Type": "Aggregate",
      "Total Cost": 200.0,
      Plans: [
        {
          "Node Type": "Index Scan",
          Schema: "public",
          "Relation Name": "small",
          Alias: "small",
          "Total Cost": 5.0,
        },
        {
          "Node Type": "Index Scan",
          Schema: "public",
          "Relation Name": "big",
          Alias: "big",
          "Total Cost": 100.0,
        },
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "same",
          Alias: "same",
          "Total Cost": 50.0,
        },
      ],
    },
  },
];

/* ----------------------------- helpers ----------------------------- */

function isEmptyDiff(d: PlanDiff): boolean {
  return (    d.matched.length === 0 &&
    d.addedRight.length === 0 &&
    d.removedLeft.length === 0 &&
    d.summary.totalCostLeft === null &&
    d.summary.totalCostRight === null &&
    d.summary.totalTimeLeft === null &&
    d.summary.totalTimeRight === null &&
    d.summary.leftNodeCount === 0 &&
    d.summary.rightNodeCount === 0
);
}

/* ----------------------------- tests ------------------------------- */

describe("diffPlans — PAIR_SAME_PLAN", () => {
  it("matches every node, no add/remove, all costDeltas zero", () => {
    const d = diffPlans(SIMPLE_PLAN, SIMPLE_PLAN);
    expect(d.summary.leftNodeCount).toBe(2);
    expect(d.summary.rightNodeCount).toBe(2);
    expect(d.matched).toHaveLength(d.summary.leftNodeCount);
    expect(d.addedRight).toEqual([]);
    expect(d.removedLeft).toEqual([]);
    for (const m of d.matched) {
      expect(m.costDelta).toBe(0);
      expect(m.nodeTypeChanged).toBe(false);
    }
  });
});

describe("diffPlans — PAIR_INDEX_ADDED", () => {
  it("flags exactly one nodeTypeChanged with negative costDelta", () => {
    const d = diffPlans(SIMPLE_PLAN, INDEX_PLAN);
    expect(d.matched).toHaveLength(2); // Sort + relation
    const changed = d.matched.filter((m) => m.nodeTypeChanged);
    expect(changed).toHaveLength(1);
    const changedSole: MatchedNode = changed[0];
    expect(changedSole.leftNodeType).toBe("Seq Scan");
    expect(changedSole.rightNodeType).toBe("Index Scan");
    expect(changedSole.costDelta).not.toBeNull();
    expect((changedSole.costDelta as number) < 0).toBe(true);
    expect(changedSole.label).toContain("Seq Scan");
    expect(changedSole.label).toContain("Index Scan");
  });
});

describe("diffPlans — PAIR_STALE_VS_FRESH", () => {
  it("matches all, costDelta ≈ 0, rowsDelta non-zero", () => {
    const d = diffPlans(STALE_PLAN, SIMPLE_PLAN);
    expect(d.matched).toHaveLength(2);
    expect(d.addedRight).toEqual([]);
    expect(d.removedLeft).toEqual([]);
    for (const m of d.matched) {
      expect(m.costDelta).toBe(0);
    }
    // The Seq Scan on users should report a non-zero rowsDelta
    const seqScan = mustFind(      d.matched,
      (m) => m.identityKey === "rel:public.users:users",
      "users seq scan match",
);
    expect(seqScan.rowsDelta).not.toBeNull();
    expect(seqScan.rowsDelta).not.toBe(0);
  });
});

describe("diffPlans — PAIR_DIFFERENT_JOIN_ORDER", () => {
  it("matches relations across reordered structural siblings", () => {
    const d = diffPlans(JOIN_LEFT, JOIN_RIGHT_REORDERED);
    // a, b — both relations should match
    const aMatch = mustFind(d.matched, (m) => m.identityKey === "rel:public.a:a", "a match");
    const bMatch = mustFind(d.matched, (m) => m.identityKey === "rel:public.b:b", "b match");
    expect(aMatch.costDelta).toBe(0);
    expect(bMatch.costDelta).toBe(0);
    // The structural Hash Join root key matches by parent + sibling-index #0
    // so the Hash Join is also matched
    const hjMatch = d.matched.find((m) => m.leftNodeType === "Hash Join");
    expect(hjMatch).toBeDefined();
    // Counts plausible
    expect(d.summary.leftNodeCount).toBe(d.summary.rightNodeCount);
  });
});

describe("diffPlans — PAIR_DISJOINT", () => {
  it("matches nothing; all nodes go to addedRight/removedLeft", () => {
    const d = diffPlans(SIMPLE_PLAN, DISJOINT_PLAN);
    // Disjoint relations and disjoint root structural keys
    const sharedKeys = d.matched.length;
    // The structural roots ("Sort" vs "Aggregate") have different identity keys
    // because their Node Type differs, so the root structural key won't match.
    // No relation is shared either → matched should be empty.
    expect(sharedKeys).toBe(0);
    expect(d.addedRight.length).toBe(d.summary.rightNodeCount);
    expect(d.removedLeft.length).toBe(d.summary.leftNodeCount);
  });
});

describe("diffPlans — PAIR_SELF_JOIN", () => {
  it("self-join aliases produce two distinct relation matches", () => {
    const d = diffPlans(SELF_JOIN_PLAN, SELF_JOIN_PLAN);
    const u1 = mustFind(d.matched, (m) => m.identityKey === "rel:public.users:u1", "u1 match");
    const u2 = mustFind(d.matched, (m) => m.identityKey === "rel:public.users:u2", "u2 match");
    expect(u1.identityKey).not.toBe(u2.identityKey);
    expect(u1.costDelta).toBe(0);
    expect(u2.costDelta).toBe(0);
  });
});

describe("diffPlans — property: diffPlans(p, p) is identity", () => {
  const fixtures = [SIMPLE_PLAN, INDEX_PLAN, JOIN_LEFT, SELF_JOIN_PLAN, NO_ANALYZE_PLAN];
  for (let i = 0; i < fixtures.length; i++) {
    it(`fixture #${i}: identity diff`, () => {
      const d = diffPlans(fixtures[i], fixtures[i]);
      expect(d.matched.length).toBe(d.summary.leftNodeCount);
      expect(d.summary.leftNodeCount).toBe(d.summary.rightNodeCount);
      expect(d.addedRight).toEqual([]);
      expect(d.removedLeft).toEqual([]);
      for (const m of d.matched) {
        expect(m.costDelta === 0 || m.costDelta === null).toBe(true);
        if (m.timeDelta !== null) expect(m.timeDelta).toBe(0);
        if (m.rowsDelta !== null) expect(m.rowsDelta).toBe(0);
        expect(m.nodeTypeChanged).toBe(false);
      }
    });
  }
});

describe("diffPlans — malformed input never throws", () => {
  const cases: unknown[] = [null, undefined, {}, [], [{}], [{ no_plan: true }], 42, "string"];
  for (let i = 0; i < cases.length; i++) {
    it(`case #${i}: ${JSON.stringify(cases[i])}`, () => {
      // Both sides malformed
      const d = diffPlans(cases[i], cases[i]);
      expect(isEmptyDiff(d)).toBe(true);
      // Mixed: malformed left, valid right → also empty
      const d2 = diffPlans(cases[i], SIMPLE_PLAN);
      expect(d2.matched).toEqual([]);
      expect(d2.removedLeft).toEqual([]);
      // valid right populates the addedRight + right summary
      expect(d2.summary.rightNodeCount).toBe(2);
      expect(d2.addedRight.length).toBe(2);
      // and the inverse
      const d3 = diffPlans(SIMPLE_PLAN, cases[i]);
      expect(d3.matched).toEqual([]);
      expect(d3.addedRight).toEqual([]);
      expect(d3.summary.leftNodeCount).toBe(2);
      expect(d3.removedLeft.length).toBe(2);
    });
  }
});

describe("diffPlans — summary fields", () => {
  it("populates totalCost/Time correctly for ANALYZE'd plans", () => {
    const d = diffPlans(SIMPLE_PLAN, INDEX_PLAN);
    expect(d.summary.totalCostLeft).toBe(100.5);
    expect(d.summary.totalCostRight).toBe(30.0);
    expect(d.summary.totalTimeLeft).toBe(12.3);
    expect(d.summary.totalTimeRight).toBe(4.0);
    expect(d.summary.leftNodeCount).toBeGreaterThan(0);
    expect(d.summary.rightNodeCount).toBeGreaterThan(0);
  });

  it("leaves totalTime null when one plan lacks ANALYZE; matched timeDelta is null", () => {
    const d = diffPlans(NO_ANALYZE_PLAN, SIMPLE_PLAN);
    expect(d.summary.totalTimeLeft).toBeNull();
    expect(d.summary.totalTimeRight).toBe(12.3);
    expect(d.summary.totalCostLeft).toBe(100.5);
    expect(d.summary.totalCostRight).toBe(100.5);
    // costDelta still computed; timeDelta + rowsDelta null because left lacks Actual fields
    for (const m of d.matched) {
      expect(m.costDelta).toBe(0);
      expect(m.timeDelta).toBeNull();
      expect(m.rowsDelta).toBeNull();
    }
  });
});

describe("diffPlans — sorting", () => {
  it("nodeTypeChanged DESC, then |costDelta| DESC", () => {
    const d = diffPlans(SORT_LEFT, SORT_RIGHT);
    // We expect matches for: Aggregate (same type), small (changed), big (changed), same (same)
    expect(d.matched.length).toBe(4);

    // Validate: all true values come before false
    const changedFlags = d.matched.map((m) => m.nodeTypeChanged);
    let sawFalse = false;
    for (const flag of changedFlags) {
      if (!flag) sawFalse = true;
      else if (sawFalse) {
        throw new Error("nodeTypeChanged=true must come before false");
      }
    }
    // Among the changed (first two), |costDelta| descending: big (-800) before small (-5)
    const changed = d.matched.filter((m) => m.nodeTypeChanged);
    expect(changed.length).toBe(2);
    const absCosts = changed.map((m) => Math.abs(m.costDelta ?? 0));
    expect(absCosts[0]).toBeGreaterThanOrEqual(absCosts[1]);
    // Confirm the big relation comes first
    expect(changed[0].identityKey).toBe("rel:public.big:big");
    expect(changed[1].identityKey).toBe("rel:public.small:small");
  });
});
