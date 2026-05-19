// — Object Editor sub-store.
//
// Per-tab form state, keyed by editor tab id (the same id minted by
// `useEditor.openObjectEditor`). The store lives separately from the main
// editor store because object-editor tabs have heavy form payloads that
// shouldn't churn the editor store on every keystroke.

import { create } from "zustand";

import type {
  CompositeTypeForm,
  DomainTypeForm,
  EnumTypeForm,
  FdwServerForm,
  FunctionForm,
  IndexForm,
  MatviewForm,
  ProcedureForm,
  PublicationForm,
  RangeTypeForm,
  RoleForm,
  SequenceForm,
  SubscriptionForm,
  TableForm,
  TriggerForm,
  ViewForm,
} from "./ddl/types";

export type EditorFormState =
  | { kind: "table"; form: TableForm; initial: TableForm | null }
  | { kind: "view"; form: ViewForm; initial: ViewForm | null }
  | { kind: "matview"; form: MatviewForm; initial: MatviewForm | null }
  | { kind: "index"; form: IndexForm; initial: IndexForm | null }
  | { kind: "sequence"; form: SequenceForm; initial: SequenceForm | null }
  | { kind: "function"; form: FunctionForm; initial: FunctionForm | null }
  | { kind: "procedure"; form: ProcedureForm; initial: ProcedureForm | null }
  | { kind: "trigger"; form: TriggerForm; initial: TriggerForm | null }
  | { kind: "fdw_server"; form: FdwServerForm; initial: FdwServerForm | null }
  | { kind: "publication"; form: PublicationForm; initial: PublicationForm | null }
  | { kind: "subscription"; form: SubscriptionForm; initial: SubscriptionForm | null }
  | { kind: "role"; form: RoleForm; initial: RoleForm | null }
  | { kind: "enum_type"; form: EnumTypeForm; initial: EnumTypeForm | null }
  | { kind: "composite_type"; form: CompositeTypeForm; initial: CompositeTypeForm | null }
  | { kind: "domain_type"; form: DomainTypeForm; initial: DomainTypeForm | null }
  | { kind: "range_type"; form: RangeTypeForm; initial: RangeTypeForm | null };

export type ApplyState =
  | { phase: "idle" }
  | { phase: "confirming" }
  | { phase: "applying" }
  | { phase: "error"; message: string }
  | { phase: "success" };

type ObjectEditorStore = {
  formByTab: Record<string, EditorFormState>;
  applyByTab: Record<string, ApplyState>;
  setForm: (tabId: string, state: EditorFormState) => void;
  updateForm: (tabId: string, mutator: (state: EditorFormState) => EditorFormState) => void;
  setApply: (tabId: string, state: ApplyState) => void;
  clearTab: (tabId: string) => void;
};

export const useObjectEditorStore = create<ObjectEditorStore>((set) => ({
  formByTab: {},
  applyByTab: {},
  setForm: (tabId, state) => set((s) => ({ formByTab: { ...s.formByTab, [tabId]: state } })),
  updateForm: (tabId, mutator) =>
    set((s) => {
      const cur = s.formByTab[tabId];
      if (!cur) return s;
      return { formByTab: { ...s.formByTab, [tabId]: mutator(cur) } };
    }),
  setApply: (tabId, state) => set((s) => ({ applyByTab: { ...s.applyByTab, [tabId]: state } })),
  clearTab: (tabId) =>
    set((s) => {
      const formByTab = { ...s.formByTab };
      const applyByTab = { ...s.applyByTab };
      delete formByTab[tabId];
      delete applyByTab[tabId];
      return { formByTab, applyByTab };
    }),
}));
