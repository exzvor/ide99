// — store compile-test for the 8 new EditorFormState variants.
//
// Phase A6 added fdw_server / publication / subscription / role /
// enum_type / composite_type / domain_type / range_type to
// EditorFormState. This test serves both as a runtime smoke (the store
// stores and returns each variant) and — more importantly — as a TypeScript
// compile-time guard that the structural shapes B3 will hand to setForm
// match the union exactly. If any field in the form types drifts, this
// test will fail to compile.

import { describe, expect, it } from "vitest";
import type {
  CompositeTypeForm,
  DomainTypeForm,
  EnumTypeForm,
  FdwServerForm,
  PublicationForm,
  RangeTypeForm,
  RoleForm,
  SubscriptionForm,
} from "../ddl/types";
import { type EditorFormState, useObjectEditorStore } from "../store";

describe("S25 EditorFormState variants", () => {
  it("accepts each new kind via setForm", () => {
    const tabId = "test-tab";
    const fdw: FdwServerForm = {
      name: "s",
      fdwName: "f",
      options: [],
      userMappings: [],
      comment: null,
    };
    const pub: PublicationForm = {
      name: "p",
      mode: "tables",
      schemas: [],
      tables: [],
      publishInsert: true,
      publishUpdate: true,
      publishDelete: true,
      publishTruncate: true,
      publishViaPartitionRoot: false,
      comment: null,
    };
    const sub: SubscriptionForm = {
      name: "sub",
      conninfo: "",
      publications: [],
      enabled: true,
      copyData: true,
      createSlot: true,
      comment: null,
    };
    const role: RoleForm = {
      name: "r",
      login: true,
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
    };
    const enumForm: EnumTypeForm = {
      schema: "public",
      name: "e",
      values: [],
      comment: null,
    };
    const compForm: CompositeTypeForm = {
      schema: "public",
      name: "c",
      fields: [],
      comment: null,
    };
    const domForm: DomainTypeForm = {
      schema: "public",
      name: "d",
      baseType: "int",
      notNull: false,
      constraints: [],
      comment: null,
    };
    const rangeForm: RangeTypeForm = {
      schema: "public",
      name: "r",
      subtype: "int4",
      comment: null,
    };

    const variants: EditorFormState[] = [
      { kind: "fdw_server", form: fdw, initial: null },
      { kind: "publication", form: pub, initial: null },
      { kind: "subscription", form: sub, initial: null },
      { kind: "role", form: role, initial: null },
      { kind: "enum_type", form: enumForm, initial: null },
      { kind: "composite_type", form: compForm, initial: null },
      { kind: "domain_type", form: domForm, initial: null },
      { kind: "range_type", form: rangeForm, initial: null },
    ];

    for (const v of variants) {
      const id = `${tabId}-${v.kind}`;
      useObjectEditorStore.getState().setForm(id, v);
      expect(useObjectEditorStore.getState().formByTab[id]).toEqual(v);
    }
  });
});
