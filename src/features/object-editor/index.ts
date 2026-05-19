// — Object Editor feature public surface.

export { ObjectEditorTab } from "./ObjectEditorTab";
export { useObjectEditorStore } from "./store";
export type { ApplyState, EditorFormState } from "./store";
export { generateIndexDdl } from "./ddl/indexDdl";
export { generateMatviewDdl } from "./ddl/matviewDdl";
export { generateSequenceDdl } from "./ddl/sequenceDdl";
export { generateTableDdl } from "./ddl/tableDdl";
export { generateViewDdl } from "./ddl/viewDdl";
export { generateFunctionDdl } from "./ddl/functionDdl";
export { generateProcedureDdl } from "./ddl/procedureDdl";
export { generateTriggerDdl } from "./ddl/triggerDdl";
export type {
  ColumnForm,
  ConstraintForm,
  DdlError,
  DdlResult,
  DdlWarning,
  IndexColumnForm,
  IndexForm,
  MatviewForm,
  PartitionStub,
  RlsPolicyStub,
  ReferentialAction,
  SequenceForm,
  TableForm,
  ViewForm,
} from "./ddl/types";

// B4 — shared UI primitives.
export { ApplyFooter } from "./shared/ApplyFooter";
export { DdlPreviewPanel } from "./shared/DdlPreviewPanel";
export { HelpLink } from "./shared/HelpLink";
export { formStateDirty } from "./shared/formStateDirty";

// B4 — introspect transforms (Definition → Form).
export { fromDefinition as indexFromDefinition } from "./introspect/indexState";
export { fromDefinition as matviewFromDefinition } from "./introspect/matviewState";
export { fromDefinition as sequenceFromDefinition } from "./introspect/sequenceState";
export { fromDefinition as tableFromDefinition } from "./introspect/tableState";
export { fromDefinition as viewFromDefinition } from "./introspect/viewState";

// — function / procedure / trigger editors.
export { FunctionEditor } from "./FunctionEditor";
export { ProcedureEditor } from "./ProcedureEditor";
export { TriggerEditor } from "./TriggerEditor";
export type {
  FunctionForm,
  FunctionLanguage,
  FunctionParameter,
  ParallelSafety,
  ParameterMode,
  ProcedureForm,
  ReturnKind,
  TriggerEventsForm,
  TriggerForm,
  Volatility,
} from "./ddl/types";

// — introspect transforms (Definition → Form) + Monaco PL/pgSQL grammar.
export { fromDefinition as functionFromDefinition } from "./introspect/functionState";
export { fromDefinition as procedureFromDefinition } from "./introspect/procedureState";
export { fromDefinition as triggerFromDefinition } from "./introspect/triggerState";
export { PLPGSQL_LANGUAGE_ID, registerPlpgsqlLanguage } from "./FunctionEditor/plpgsqlLanguage";

// — FDW / Publication / Subscription / Role / Custom Type editors.
export { FdwServerEditor } from "./FdwServerEditor";
export { PublicationEditor } from "./PublicationEditor";
export { SubscriptionEditor } from "./SubscriptionEditor";
export { RoleEditor } from "./RoleEditor";
export {
  CompositeTypeEditor,
  DomainTypeEditor,
  EnumTypeEditor,
  RangeTypeEditor,
} from "./TypeEditor";

export type {
  CompositeFieldForm,
  CompositeTypeForm,
  DomainConstraintForm,
  DomainTypeForm,
  EnumTypeForm,
  EnumValueForm,
  FdwServerForm,
  KvOptionForm,
  PublicationForm,
  PublicationMode,
  QualifiedNameForm,
  RangeTypeForm,
  RoleForm,
  SubscriptionForm,
  UserMappingForm,
} from "./ddl/types";

// — introspect transforms (Definition → Form).
export { fromDefinition as fdwServerFromDefinition } from "./introspect/fdwServerState";
export { fromDefinition as publicationFromDefinition } from "./introspect/publicationState";
export { fromDefinition as subscriptionFromDefinition } from "./introspect/subscriptionState";
export { fromDefinition as roleFromDefinition } from "./introspect/roleState";
export {
  fromDefinition as typeFromDefinition,
  type CustomTypeFormUnion,
} from "./introspect/typeState";

// — DDL generators (B2).
export { generateFdwServerDdl } from "./ddl/fdwServerDdl";
export { generatePublicationDdl } from "./ddl/publicationDdl";
export { generateSubscriptionDdl } from "./ddl/subscriptionDdl";
export { generateRoleDdl } from "./ddl/roleDdl";
export { generateTypeDdl, type TypeFormUnion } from "./ddl/typeDdl";
