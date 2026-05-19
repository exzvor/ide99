import { describe, expect, it } from "vitest";
import { generateRoleDdl } from "./roleDdl";
import type { RoleForm } from "./types";

const baseForm = (overrides: Partial<RoleForm> = {}): RoleForm => ({
  name: "alice",
  login: false,
  superuser: false,
  createdb: false,
  createrole: false,
  replication: false,
  bypassrls: false,
  inherit: true,
  connectionLimit: -1,
  passwordIsHash: false,
  memberOf: [],
  comment: null,
  ...overrides,
});

describe("generateRoleDdl", () => {
  it("create with login + createdb + connection limit", () => {
    const r = generateRoleDdl(null, baseForm({ login: true, createdb: true, connectionLimit: 50 }));
    expect(r.sql).toContain("CREATE ROLE alice WITH");
    expect(r.sql).toContain("LOGIN");
    expect(r.sql).toContain("CREATEDB");
    expect(r.sql).toContain("CONNECTION LIMIT 50");
    expect(r.warnings).toHaveLength(0);
  });

  it("create with valid_until", () => {
    const r = generateRoleDdl(null, baseForm({ validUntil: "2030-01-01" }));
    expect(r.sql).toContain("VALID UNTIL '2030-01-01'");
  });

  it("create with member_of memberships emits GRANT lines", () => {
    const r = generateRoleDdl(null, baseForm({ memberOf: ["readers", "writers"] }));
    expect(r.sql).toContain("CREATE ROLE alice");
    expect(r.sql).toContain("GRANT readers TO alice;");
    expect(r.sql).toContain("GRANT writers TO alice;");
  });

  it("rename emits ALTER ROLE RENAME TO", () => {
    const init = baseForm();
    const cur = baseForm({ name: "alice2" });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toContain("ALTER ROLE alice RENAME TO alice2;");
  });

  it("login toggle false→true emits ALTER ROLE LOGIN", () => {
    const init = baseForm({ login: false });
    const cur = baseForm({ login: true });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toBe("ALTER ROLE alice LOGIN;");
  });

  it("login toggle true→false emits ALTER ROLE NOLOGIN", () => {
    const init = baseForm({ login: true });
    const cur = baseForm({ login: false });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toBe("ALTER ROLE alice NOLOGIN;");
  });

  it("connectionLimit change emits ALTER ROLE CONNECTION LIMIT", () => {
    const init = baseForm({ connectionLimit: -1 });
    const cur = baseForm({ connectionLimit: 100 });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toBe("ALTER ROLE alice CONNECTION LIMIT 100;");
  });

  it("validUntil change emits ALTER ROLE VALID UNTIL", () => {
    const init = baseForm();
    const cur = baseForm({ validUntil: "2030-12-31" });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toBe("ALTER ROLE alice VALID UNTIL '2030-12-31';");
  });

  it("validUntil cleared emits VALID UNTIL 'infinity'", () => {
    const init = baseForm({ validUntil: "2030-01-01" });
    const cur = baseForm();
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toBe("ALTER ROLE alice VALID UNTIL 'infinity';");
  });

  it("password set emits ALTER ROLE PASSWORD + warning", () => {
    const init = baseForm();
    const cur = baseForm({ password: "p@ss" });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toContain("ALTER ROLE alice PASSWORD 'p@ss';");
    expect(r.warnings.some((w) => w.code === "role_password_visible")).toBe(true);
  });

  it("passwordIsHash=true emits ENCRYPTED PASSWORD", () => {
    const init = baseForm();
    const cur = baseForm({ password: "md5abc", passwordIsHash: true });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toContain("ALTER ROLE alice ENCRYPTED PASSWORD 'md5abc';");
  });

  it("member_of add emits GRANT", () => {
    const init = baseForm({ memberOf: ["readers"] });
    const cur = baseForm({ memberOf: ["readers", "writers"] });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toBe("GRANT writers TO alice;");
  });

  it("member_of drop emits REVOKE", () => {
    const init = baseForm({ memberOf: ["readers", "writers"] });
    const cur = baseForm({ memberOf: ["readers"] });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).toBe("REVOKE writers FROM alice;");
  });

  it("empty password (initial null current empty) emits no PASSWORD ddl", () => {
    const init = baseForm();
    const cur = baseForm({ password: "" });
    const r = generateRoleDdl(init, cur);
    expect(r.sql).not.toContain("PASSWORD");
    expect(r.warnings.some((w) => w.code === "role_password_visible")).toBe(false);
  });

  it("no diff emits empty sql", () => {
    const f = baseForm();
    const r = generateRoleDdl(f, f);
    expect(r.sql).toBe("");
  });
});
