// — CustomTypeDefinitionDto → discriminated CustomTypeFormUnion.
//
// The backend returns a Zod-validated discriminated union over `kind`. We
// dispatch to a per-kind branch and stamp UUIDs onto every per-row collection
// (enum values, composite fields, domain CHECK constraints) so the editor's
// form-state diff can detect rename / drop+add. Range types have no per-row
// collection so they're a flat field copy.
//
// Domain CHECK constraints come back without an `isNew` flag — every
// introspected constraint represents a row that already exists in pg_constraint,
// so we pin `isNew: false`. Editor-added rows set the flag themselves.

import type { CustomTypeDefinitionDto } from "../../../lib/tauri";
import type {
  CompositeTypeForm,
  DomainConstraintForm,
  DomainTypeForm,
  EnumTypeForm,
  RangeTypeForm,
} from "../ddl/types";

export type CustomTypeFormUnion =
  | { kind: "enum"; form: EnumTypeForm }
  | { kind: "composite"; form: CompositeTypeForm }
  | { kind: "domain"; form: DomainTypeForm }
  | { kind: "range"; form: RangeTypeForm };

export function fromDefinition(def: CustomTypeDefinitionDto): CustomTypeFormUnion {
  switch (def.kind) {
    case "enum":
      return {
        kind: "enum",
        form: {
          schema: def.schema,
          name: def.name,
          values: def.values.map((v) => ({ id: crypto.randomUUID(), value: v })),
          comment: def.comment ?? null,
        },
      };
    case "composite":
      return {
        kind: "composite",
        form: {
          schema: def.schema,
          name: def.name,
          fields: def.fields.map((f) => ({
            id: crypto.randomUUID(),
            fieldName: f.name,
            typeText: f.typeText,
            collation: f.collation ?? undefined,
          })),
          comment: def.comment ?? null,
        },
      };
    case "domain":
      return {
        kind: "domain",
        form: {
          schema: def.schema,
          name: def.name,
          baseType: def.baseType,
          notNull: def.notNull,
          default: def.default ?? undefined,
          collation: def.collation ?? undefined,
          constraints: def.constraints.map<DomainConstraintForm>((c) => ({
            id: crypto.randomUUID(),
            constraintName: c.name ?? undefined,
            checkExpression: c.check,
            notValid: c.notValid,
            isNew: false,
          })),
          comment: def.comment ?? null,
        },
      };
    case "range":
      return {
        kind: "range",
        form: {
          schema: def.schema,
          name: def.name,
          subtype: def.subtype,
          subtypeOpclass: def.subtypeOpclass ?? undefined,
          collation: def.collation ?? undefined,
          canonical: def.canonical ?? undefined,
          subtypeDiff: def.subtypeDiff ?? undefined,
          multirangeTypeName: def.multirangeTypeName ?? undefined,
          comment: def.comment ?? null,
        },
      };
  }
}
