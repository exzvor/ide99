// — FunctionDefinition → FunctionForm transform.
//
// Pure modulo `crypto.randomUUID()`. The backend introspects pg_proc and
// hands us a structured payload; we stamp UUIDs onto each parameter so the
// form-state diff can detect rename vs. drop+add (matches the column
// pattern).
//
// Language coercion: we keep `sql` and `plpgsql` as first-class form values;
// every other `lanname` (plpython3u, plperl, etc.) collapses to the
// `"other"` discriminator with the original name preserved in
// `languageOther` so the editor can round-trip it back via the freeform
// language input.

import type { FunctionDefinition } from "../../../lib/tauri";
import type { FunctionForm, FunctionLanguage, ParameterMode } from "../ddl/types";

function coerceLanguage(raw: string): { language: FunctionLanguage; languageOther?: string } {
  if (raw === "sql" || raw === "plpgsql") {
    return { language: raw };
  }
  return { language: "other", languageOther: raw };
}

export function fromDefinition(def: FunctionDefinition): FunctionForm {
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
    returnKind: def.returnKind,
    returnType: def.returnType ?? undefined,
    body: def.body,
    volatility: def.volatility,
    parallelSafety: def.parallelSafety,
    securityDefiner: def.securityDefiner,
    cost: def.cost,
    estimatedRows: def.estimatedRows,
    comment: def.comment,
  };
}
