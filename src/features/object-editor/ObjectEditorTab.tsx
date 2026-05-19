// — Object Editor tab router. Mounts the right per-kind editor
// based on `tab.target.objectKind`. Each editor manages its own form state
// in `useObjectEditorStore` keyed by `tab.id`.

import type { ObjectEditorTab as TabModel } from "../editor/store";

import { FdwServerEditor } from "./FdwServerEditor";
import { FunctionEditor } from "./FunctionEditor";
import { IndexEditor } from "./IndexEditor";
import { MatviewEditor } from "./MatviewEditor";
import { ProcedureEditor } from "./ProcedureEditor";
import { PublicationEditor } from "./PublicationEditor";
import { RoleEditor } from "./RoleEditor";
import { SequenceEditor } from "./SequenceEditor";
import { SubscriptionEditor } from "./SubscriptionEditor";
import { TableEditor } from "./TableEditor";
import { TriggerEditor } from "./TriggerEditor";
import {
  CompositeTypeEditor,
  DomainTypeEditor,
  EnumTypeEditor,
  RangeTypeEditor,
} from "./TypeEditor";
import { ViewEditor } from "./ViewEditor";

export interface ObjectEditorTabProps {
  tab: TabModel;
}

export function ObjectEditorTab({ tab }: ObjectEditorTabProps): JSX.Element {
  switch (tab.target.objectKind) {
    case "table":
      return <TableEditor tab={tab} />;
    case "view":
      return <ViewEditor tab={tab} />;
    case "matview":
      return <MatviewEditor tab={tab} />;
    case "index":
      return <IndexEditor tab={tab} />;
    case "sequence":
      return <SequenceEditor tab={tab} />;
    case "function":
      return <FunctionEditor tab={tab} />;
    case "procedure":
      return <ProcedureEditor tab={tab} />;
    case "trigger":
      return <TriggerEditor tab={tab} />;
    case "fdw_server":
      return <FdwServerEditor tab={tab} />;
    case "publication":
      return <PublicationEditor tab={tab} />;
    case "subscription":
      return <SubscriptionEditor tab={tab} />;
    case "role":
      return <RoleEditor tab={tab} />;
    case "enum_type":
      return <EnumTypeEditor tab={tab} />;
    case "composite_type":
      return <CompositeTypeEditor tab={tab} />;
    case "domain_type":
      return <DomainTypeEditor tab={tab} />;
    case "range_type":
      return <RangeTypeEditor tab={tab} />;
    default: {
      // Unreachable in practice — Tab type union is exhaustive — but keep a
      // guard so a malformed tab never blanks the workspace.
      const _exhaustive: never = tab.target.objectKind;
      void _exhaustive;
      return (        <div data-testid="object-editor-unknown" role="alert" style={{ padding: 16 }}>
          Unknown object kind
        </div>
);
    }
  }
}
