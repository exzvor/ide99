import { describe, expect, it } from "vitest";
import { generateFdwServerDdl } from "./fdwServerDdl";
import type { FdwServerForm } from "./types";

const baseForm = (overrides: Partial<FdwServerForm> = {}): FdwServerForm => ({
  name: "srv1",
  fdwName: "postgres_fdw",
  options: [],
  userMappings: [],
  comment: null,
  ...overrides,
});

describe("generateFdwServerDdl", () => {
  it("create with no options or mappings emits bare CREATE SERVER", () => {
    const r = generateFdwServerDdl(null, baseForm());
    expect(r.sql).toBe("CREATE SERVER srv1 FOREIGN DATA WRAPPER postgres_fdw;");
    expect(r.warnings).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });

  it("create with type, version, options, and mapping emits full DDL", () => {
    const r = generateFdwServerDdl(
      null,
      baseForm({
        serverType: "postgresql",
        version: "17",
        options: [
          { id: "1", key: "host", value: "h" },
          { id: "2", key: "port", value: "5432" },
        ],
        userMappings: [
          { id: "u1", roleName: "PUBLIC", options: [{ id: "o", key: "user", value: "u" }] },
        ],
      }),
    );
    expect(r.sql).toContain("TYPE 'postgresql'");
    expect(r.sql).toContain("VERSION '17'");
    expect(r.sql).toContain("OPTIONS (host 'h', port '5432')");
    expect(r.sql).toContain("CREATE USER MAPPING FOR PUBLIC SERVER srv1");
    expect(r.sql).toContain("OPTIONS (\"user\" 'u')");
  });

  it("rename emits ALTER SERVER RENAME TO", () => {
    const init = baseForm();
    const cur = baseForm({ name: "srv1_renamed" });
    const r = generateFdwServerDdl(init, cur);
    expect(r.sql).toBe("ALTER SERVER srv1 RENAME TO srv1_renamed;");
  });

  it("version change emits ALTER SERVER VERSION", () => {
    const init = baseForm({ version: "16" });
    const cur = baseForm({ version: "17" });
    const r = generateFdwServerDdl(init, cur);
    expect(r.sql).toBe("ALTER SERVER srv1 VERSION '17';");
  });

  it("option add/set/drop emits ALTER SERVER OPTIONS", () => {
    const init = baseForm({
      options: [
        { id: "1", key: "host", value: "old_h" },
        { id: "2", key: "drop_me", value: "x" },
      ],
    });
    const cur = baseForm({
      options: [
        { id: "1", key: "host", value: "new_h" },
        { id: "3", key: "port", value: "5432" },
      ],
    });
    const r = generateFdwServerDdl(init, cur);
    expect(r.sql).toContain("ALTER SERVER srv1 OPTIONS (");
    expect(r.sql).toContain("SET host 'new_h'");
    expect(r.sql).toContain("ADD port '5432'");
    expect(r.sql).toContain("DROP drop_me");
  });

  it("user mapping add emits CREATE USER MAPPING", () => {
    const init = baseForm();
    const cur = baseForm({
      userMappings: [
        { id: "u1", roleName: "alice", options: [{ id: "o", key: "user", value: "a" }] },
      ],
    });
    const r = generateFdwServerDdl(init, cur);
    expect(r.sql).toContain("CREATE USER MAPPING FOR alice SERVER srv1");
  });

  it("user mapping drop emits DROP USER MAPPING", () => {
    const init = baseForm({
      userMappings: [{ id: "u1", roleName: "alice", options: [] }],
    });
    const cur = baseForm();
    const r = generateFdwServerDdl(init, cur);
    expect(r.sql).toBe("DROP USER MAPPING FOR alice SERVER srv1;");
  });

  it("user mapping option diff emits ALTER USER MAPPING", () => {
    const init = baseForm({
      userMappings: [
        {
          id: "u1",
          roleName: "alice",
          options: [{ id: "o", key: "user", value: "old" }],
        },
      ],
    });
    const cur = baseForm({
      userMappings: [
        {
          id: "u1",
          roleName: "alice",
          options: [{ id: "o", key: "user", value: "new" }],
        },
      ],
    });
    const r = generateFdwServerDdl(init, cur);
    expect(r.sql).toContain(
      "ALTER USER MAPPING FOR alice SERVER srv1 OPTIONS (SET \"user\" 'new')",
    );
  });

  it("fdw_name change emits DROP+CREATE warning", () => {
    const init = baseForm({ fdwName: "postgres_fdw" });
    const cur = baseForm({ fdwName: "file_fdw" });
    const r = generateFdwServerDdl(init, cur);
    expect(r.warnings.some((w) => w.code === "fdw_recreate_required")).toBe(true);
    expect(r.sql).toContain("DROP SERVER srv1 CASCADE;");
    expect(r.sql).toContain("CREATE SERVER srv1 FOREIGN DATA WRAPPER file_fdw");
  });

  it("server_type change emits DROP+CREATE warning", () => {
    const init = baseForm({ serverType: "old_type" });
    const cur = baseForm({ serverType: "new_type" });
    const r = generateFdwServerDdl(init, cur);
    expect(r.warnings.some((w) => w.code === "fdw_recreate_required")).toBe(true);
    expect(r.sql).toContain("DROP SERVER srv1 CASCADE;");
  });

  it("no diff emits empty sql", () => {
    const f = baseForm();
    const r = generateFdwServerDdl(f, f);
    expect(r.sql).toBe("");
  });

  it("create with options only (no type/version) renders OPTIONS clause", () => {
    const r = generateFdwServerDdl(
      null,
      baseForm({
        options: [{ id: "1", key: "dbname", value: "mydb" }],
      }),
    );
    expect(r.sql).toBe(
      "CREATE SERVER srv1 FOREIGN DATA WRAPPER postgres_fdw OPTIONS (dbname 'mydb');",
    );
  });
});
