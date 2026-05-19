// — RoleDefinitionDto → RoleForm transform tests.

import { describe, expect, it } from "vitest";
import type { RoleDefinitionDto } from "../../../lib/tauri";
import { fromDefinition } from "./roleState";

const baseAttrs = {
  login: true,
  superuser: false,
  createdb: false,
  createrole: false,
  replication: false,
  bypassrls: false,
  inherit: true,
  connectionLimit: -1,
};

describe("roleState.fromDefinition", () => {
  it("round-trips every boolean attribute", () => {
    const def: RoleDefinitionDto = {
      name: "alice",
      login: true,
      superuser: true,
      createdb: true,
      createrole: true,
      replication: true,
      bypassrls: true,
      inherit: false,
      connectionLimit: 50,
      memberOf: [],
    };
    const f = fromDefinition(def);
    expect(f.name).toBe("alice");
    expect(f.login).toBe(true);
    expect(f.superuser).toBe(true);
    expect(f.createdb).toBe(true);
    expect(f.createrole).toBe(true);
    expect(f.replication).toBe(true);
    expect(f.bypassrls).toBe(true);
    expect(f.inherit).toBe(false);
    expect(f.connectionLimit).toBe(50);
  });

  it("never echoes the password and pins passwordIsHash to false", () => {
    const def: RoleDefinitionDto = {
      name: "r",
      ...baseAttrs,
      memberOf: [],
    };
    const f = fromDefinition(def);
    expect(f.password).toBeUndefined();
    expect(f.passwordIsHash).toBe(false);
  });

  it("clones memberOf and preserves validUntil + comment", () => {
    const def: RoleDefinitionDto = {
      name: "bob",
      ...baseAttrs,
      validUntil: "2027-01-01T00:00:00Z",
      memberOf: ["readers", "writers"],
      comment: "service account",
    };
    const f = fromDefinition(def);
    expect(f.validUntil).toBe("2027-01-01T00:00:00Z");
    expect(f.memberOf).toEqual(["readers", "writers"]);
    expect(f.memberOf).not.toBe(def.memberOf);
    expect(f.comment).toBe("service account");
  });

  it("collapses null validUntil/comment to undefined/null respectively", () => {
    const def: RoleDefinitionDto = {
      name: "r2",
      ...baseAttrs,
      validUntil: null,
      memberOf: [],
      comment: null,
    };
    const f = fromDefinition(def);
    expect(f.validUntil).toBeUndefined();
    expect(f.comment).toBeNull();
  });
});
