// — PublicationDefinitionDto → PublicationForm transform tests.

import { describe, expect, it } from "vitest";
import type { PublicationDefinitionDto } from "../../../lib/tauri";
import { fromDefinition } from "./publicationState";

const basePub = {
  publishInsert: true,
  publishUpdate: true,
  publishDelete: true,
  publishTruncate: true,
  publishViaPartitionRoot: false,
};

describe("publicationState.fromDefinition", () => {
  it("maps FOR ALL TABLES to mode=all_tables", () => {
    const def: PublicationDefinitionDto = {
      name: "p_all",
      allTables: true,
      schemas: [],
      tables: [],
      ...basePub,
    };
    const f = fromDefinition(def);
    expect(f.mode).toBe("all_tables");
    expect(f.schemas).toEqual([]);
    expect(f.tables).toEqual([]);
    expect(f.comment).toBeNull();
  });

  it("non-empty schemas yields mode=schemas", () => {
    const def: PublicationDefinitionDto = {
      name: "p_sch",
      allTables: false,
      schemas: ["public", "audit"],
      tables: [],
      ...basePub,
      comment: "schema-mode pub",
    };
    const f = fromDefinition(def);
    expect(f.mode).toBe("schemas");
    expect(f.schemas).toEqual(["public", "audit"]);
    expect(f.comment).toBe("schema-mode pub");
  });

  it("falls back to mode=tables and stamps ids on rows", () => {
    const def: PublicationDefinitionDto = {
      name: "p_tab",
      allTables: false,
      schemas: [],
      tables: [
        { schema: "public", name: "t1" },
        { schema: "public", name: "t2" },
      ],
      ...basePub,
    };
    const f = fromDefinition(def);
    expect(f.mode).toBe("tables");
    expect(f.tables).toHaveLength(2);
    expect(f.tables[0].id).not.toBe("");
    expect(f.tables[0].id).not.toBe(f.tables[1].id);
    expect(f.tables[0].schema).toBe("public");
    expect(f.tables[0].name).toBe("t1");
  });

  it("passes through publish flags and comment null", () => {
    const def: PublicationDefinitionDto = {
      name: "p",
      allTables: false,
      schemas: [],
      tables: [],
      publishInsert: false,
      publishUpdate: true,
      publishDelete: false,
      publishTruncate: false,
      publishViaPartitionRoot: true,
      comment: null,
    };
    const f = fromDefinition(def);
    expect(f.publishInsert).toBe(false);
    expect(f.publishUpdate).toBe(true);
    expect(f.publishDelete).toBe(false);
    expect(f.publishTruncate).toBe(false);
    expect(f.publishViaPartitionRoot).toBe(true);
    expect(f.comment).toBeNull();
  });
});
