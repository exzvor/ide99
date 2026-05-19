import { describe, expect, it } from "vitest";
import { generateSubscriptionDdl } from "./subscriptionDdl";
import type { SubscriptionForm } from "./types";

const baseForm = (overrides: Partial<SubscriptionForm> = {}): SubscriptionForm => ({
  name: "sub1",
  conninfo: "host=primary dbname=src user=replica password=secret",
  publications: ["pub1"],
  enabled: true,
  copyData: true,
  createSlot: true,
  comment: null,
  ...overrides,
});

describe("generateSubscriptionDdl", () => {
  it("create with all options + slot/sync_commit emits CREATE SUBSCRIPTION + warning", () => {
    const r = generateSubscriptionDdl(
      null,
      baseForm({
        slotName: "my_slot",
        synchronousCommit: "on",
      }),
    );
    expect(r.sql).toContain("CREATE SUBSCRIPTION sub1");
    expect(r.sql).toContain("CONNECTION 'host=primary dbname=src user=replica password=secret'");
    expect(r.sql).toContain("PUBLICATION pub1");
    expect(r.sql).toContain("enabled = true");
    expect(r.sql).toContain("copy_data = true");
    expect(r.sql).toContain("create_slot = true");
    expect(r.sql).toContain("slot_name = 'my_slot'");
    expect(r.sql).toContain("synchronous_commit = 'on'");
    expect(r.warnings.some((w) => w.code === "subscription_password_visible")).toBe(true);
  });

  it("create minimal (no slot, no sync_commit) emits no slot_name/synchronous_commit lines", () => {
    const r = generateSubscriptionDdl(null, baseForm());
    expect(r.sql).toContain("CREATE SUBSCRIPTION sub1");
    expect(r.sql).not.toContain("slot_name");
    expect(r.sql).not.toContain("synchronous_commit");
  });

  it("rename emits ALTER SUBSCRIPTION RENAME TO", () => {
    const init = baseForm();
    const cur = baseForm({ name: "sub1_renamed" });
    const r = generateSubscriptionDdl(init, cur);
    expect(r.sql).toContain("ALTER SUBSCRIPTION sub1 RENAME TO sub1_renamed;");
  });

  it("conninfo change emits ALTER SUBSCRIPTION CONNECTION + password warning", () => {
    const init = baseForm({ conninfo: "host=old" });
    const cur = baseForm({ conninfo: "host=new password=p" });
    const r = generateSubscriptionDdl(init, cur);
    expect(r.sql).toContain("ALTER SUBSCRIPTION sub1 CONNECTION 'host=new password=p';");
    expect(r.warnings.some((w) => w.code === "subscription_password_visible")).toBe(true);
  });

  it("publications add emits ALTER SUBSCRIPTION ADD PUBLICATION", () => {
    const init = baseForm({ publications: ["pub1"] });
    const cur = baseForm({ publications: ["pub1", "pub2"] });
    const r = generateSubscriptionDdl(init, cur);
    expect(r.sql).toBe("ALTER SUBSCRIPTION sub1 ADD PUBLICATION pub2;");
  });

  it("publications drop emits ALTER SUBSCRIPTION DROP PUBLICATION", () => {
    const init = baseForm({ publications: ["pub1", "pub2"] });
    const cur = baseForm({ publications: ["pub1"] });
    const r = generateSubscriptionDdl(init, cur);
    expect(r.sql).toBe("ALTER SUBSCRIPTION sub1 DROP PUBLICATION pub2;");
  });

  it("enabled true→false emits ALTER SUBSCRIPTION DISABLE", () => {
    const init = baseForm({ enabled: true });
    const cur = baseForm({ enabled: false });
    const r = generateSubscriptionDdl(init, cur);
    expect(r.sql).toBe("ALTER SUBSCRIPTION sub1 DISABLE;");
  });

  it("enabled false→true emits ALTER SUBSCRIPTION ENABLE", () => {
    const init = baseForm({ enabled: false });
    const cur = baseForm({ enabled: true });
    const r = generateSubscriptionDdl(init, cur);
    expect(r.sql).toBe("ALTER SUBSCRIPTION sub1 ENABLE;");
  });

  it("slot_name change emits warning + no DDL line", () => {
    const init = baseForm({ slotName: "old_slot" });
    const cur = baseForm({ slotName: "new_slot" });
    const r = generateSubscriptionDdl(init, cur);
    expect(r.warnings.some((w) => w.code === "subscription_slot_rename_blocked")).toBe(true);
    expect(r.sql).not.toContain("slot_name");
  });

  it("no diff emits empty sql", () => {
    const f = baseForm();
    const r = generateSubscriptionDdl(f, f);
    expect(r.sql).toBe("");
    expect(r.warnings).toHaveLength(0);
  });
});
