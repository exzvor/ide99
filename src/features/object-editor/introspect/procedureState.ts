// — ProcedureDefinition → ProcedureForm transform.
//
// Procedures are functions minus the return-related metadata. Same
// language-coercion rules as `functionState.ts`; same UUID stamping on
// parameters for diff stability.

import type { ProcedureDefinition } from "../../../lib/tauri";
import type { FunctionLanguage, ParameterMode, ProcedureForm } from "../ddl/types";

function coerceLanguage(raw: string): { language: FunctionLanguage; languageOther?: string } {
  if (raw === "sql" || raw === "plpgsql") {
    return { language: raw };
  }
  return { language: "other", languageOther: raw };
}

export function fromDefinition(def: ProcedureDefinition): ProcedureForm {
  const { language, languageOther } = coerceLanguage(def.language);
  return {
    schema: def.schema,
    name: def.name,
    language,
    languageOther,
    parameters: def.parameters.map((p) => ({
      id: crypto.randomUUID(),
      name: p.name,
      mode: p.mode as ParameterMode,
      type: p.typeText,
      default: p.default,
    })),
    body: def.body,
    securityDefiner: def.securityDefiner,
    comment: def.comment,
  };
}
