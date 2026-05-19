// — FdwServerDefinitionDto → FdwServerForm transform tests.

import { describe, expect, it } from "vitest";
import type { FdwServerDefinitionDto } from "../../../lib/tauri";
import { fromDefinition } from "./fdwServerState";

describe("fdwServerState.fromDefinition", () => {
  it("maps minimal server", () => {
    const def: FdwServerDefinitionDto = {
      name: "srv1",
      fdwName: "postgres_fdw",
      options: [],
      userMappings: [],
    };
    const f = fromDefinition(def);
    expect(f.name).toBe("srv1");
    expect(f.fdwName).toBe("postgres_fdw");
    expect(f.options).toEqual([]);
    expect(f.userMappings).toEqual([]);
  });

  it("assigns stable UUID ids to options and mappings", () => {
    const def: FdwServerDefinitionDto = {
      name: "srv1",
      fdwName: "postgres_fdw",
      options: [
        { key: "host", value: "h" },
        { key: "port", value: "5432" },
      ],
      userMappings: [
        { roleName: "alice", options: [{ key: "user", value: "a" }] },
        { roleName: "PUBLIC", options: [] },
      ],
    };
    const f = fromDefinition(def);
    expect(f.options).toHaveLength(2);
    expect(f.options[0].id).not.toBe("");
    expect(f.options[0].id).not.toBe(f.options[1].id);
    expect(f.userMappings).toHaveLength(2);
    expect(f.userMappings[0].id).not.toBe(f.userMappings[1].id);
    expect(f.userMappings[0].options[0].id).not.toBe("");
  });

  it("preserves serverType, version, comment", () => {
    const def: FdwServerDefinitionDto = {
      name: "s",
      fdwName: "f",
      serverType: "postgresql",
      version: "17",
      options: [],
      userMappings: [],
      comment: "production",
    };
    const f = fromDefinition(def);
    expect(f.serverType).toBe("postgresql");
    expect(f.version).toBe("17");
    expect(f.comment).toBe("production");
  });

  it("treats null/undefined comment uniformly as null", () => {
    const def: FdwServerDefinitionDto = {
      name: "s",
      fdwName: "f",
      options: [],
      userMappings: [],
      comment: null,
    };
    expect(fromDefinition(def).comment).toBeNull();
  });
});
