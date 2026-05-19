// — : unit tests for time-column detection from
// query column metadata. TimescaleDB allows both timestamp-typed and
// integer-typed (epoch) columns as the time dimension.
import { describe, expect, it } from "vitest";
import { detectTimeColumns } from "../timescaleDetect";

describe("detectTimeColumns", () => {
  it("returns the empty list for an empty input", () => {
    expect(detectTimeColumns([])).toEqual([]);
  });

  it("ignores non-time columns (text, uuid, jsonb, …)", () => {
    expect(      detectTimeColumns([
        { name: "id", typeName: "uuid" },
        { name: "name", typeName: "text" },
        { name: "payload", typeName: "jsonb" },
      ]),
).toEqual([]);
  });

  it("returns every supported time-typed column preserving input order", () => {
    const cols = [
      { name: "ts1", typeName: "timestamp" },
      { name: "ts2", typeName: "timestamp without time zone" },
      { name: "ts3", typeName: "timestamptz" },
      { name: "ts4", typeName: "timestamp with time zone" },
      { name: "d", typeName: "date" },
      { name: "i2", typeName: "int2" },
      { name: "i4", typeName: "int4" },
      { name: "i8", typeName: "int8" },
      { name: "ibig", typeName: "bigint" },
      { name: "iint", typeName: "integer" },
      { name: "ismall", typeName: "smallint" },
    ];
    expect(detectTimeColumns(cols)).toEqual(cols);
  });

  it("returns only the time candidates from a mixed column list", () => {
    const cols = [
      { name: "id", typeName: "uuid" },
      { name: "ts", typeName: "timestamptz" },
      { name: "name", typeName: "text" },
      { name: "epoch", typeName: "bigint" },
      { name: "tags", typeName: "text[]" },
    ];
    expect(detectTimeColumns(cols)).toEqual([
      { name: "ts", typeName: "timestamptz" },
      { name: "epoch", typeName: "bigint" },
    ]);
  });
});
