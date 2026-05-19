// — SubscriptionDefinitionDto → SubscriptionForm transform tests.

import { describe, expect, it } from "vitest";
import type { SubscriptionDefinitionDto } from "../../../lib/tauri";
import { fromDefinition } from "./subscriptionState";

describe("subscriptionState.fromDefinition", () => {
  it("passes through every required field plus optional slot/sync", () => {
    const def: SubscriptionDefinitionDto = {
      name: "sub1",
      conninfo: "host=remote port=5432 dbname=src user=repl",
      publications: ["p1", "p2"],
      enabled: true,
      copyData: false,
      createSlot: true,
      slotName: "sub1_slot",
      synchronousCommit: "off",
      comment: "primary feed",
    };
    const f = fromDefinition(def);
    expect(f.name).toBe("sub1");
    expect(f.conninfo).toBe("host=remote port=5432 dbname=src user=repl");
    expect(f.publications).toEqual(["p1", "p2"]);
    // Defensive copy of the publications array.
    expect(f.publications).not.toBe(def.publications);
    expect(f.enabled).toBe(true);
    expect(f.copyData).toBe(false);
    expect(f.createSlot).toBe(true);
    expect(f.slotName).toBe("sub1_slot");
    expect(f.synchronousCommit).toBe("off");
    expect(f.comment).toBe("primary feed");
  });

  it("collapses null slotName / synchronousCommit to undefined", () => {
    const def: SubscriptionDefinitionDto = {
      name: "sub2",
      conninfo: "",
      publications: [],
      enabled: false,
      copyData: true,
      createSlot: false,
      slotName: null,
      synchronousCommit: null,
      comment: null,
    };
    const f = fromDefinition(def);
    expect(f.slotName).toBeUndefined();
    expect(f.synchronousCommit).toBeUndefined();
    expect(f.comment).toBeNull();
  });

  it("treats omitted optional fields the same as null", () => {
    const def: SubscriptionDefinitionDto = {
      name: "sub3",
      conninfo: "host=h",
      publications: ["only"],
      enabled: true,
      copyData: true,
      createSlot: true,
    };
    const f = fromDefinition(def);
    expect(f.slotName).toBeUndefined();
    expect(f.synchronousCommit).toBeUndefined();
    expect(f.comment).toBeNull();
  });
});
