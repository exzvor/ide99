// — : tests for the partman detection helper.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPartmanParent } from "../partmanDetect";
import { type PartmanMap, type PartmanParent, usePgPartman } from "../store";

beforeEach(() => {
  usePgPartman.setState({ parents: new Map() });
});

afterEach(() => {
  usePgPartman.setState({ parents: new Map() });
});

describe("getPartmanParent", () => {
  it("returns the matching record for a known schema/table", () => {
    const record: PartmanParent = {
      schema: "public",
      table: "events",
      controlColumn: "created_at",
      intervalText: "1 day",
      retentionText: "6 months",
      premakeCount: 4,
    };
    const map: PartmanMap = new Map([["public/events", record]]);
    usePgPartman.getState().setParents("conn-1", map);

    expect(getPartmanParent("conn-1", "public", "events")).toEqual(record);
  });

  it("returns null when the connection has no entry", () => {
    expect(getPartmanParent("missing-conn", "public", "events")).toBeNull();
  });

  it("returns null when the table is not partitioned by partman", () => {
    const map: PartmanMap = new Map([
      [
        "public/events",
        {
          schema: "public",
          table: "events",
          controlColumn: "created_at",
          intervalText: "1 day",
          retentionText: null,
          premakeCount: 4,
        },
      ],
    ]);
    usePgPartman.getState().setParents("conn-1", map);

    expect(getPartmanParent("conn-1", "public", "other_table")).toBeNull();
  });
});
