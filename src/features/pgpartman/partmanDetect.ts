// — synchronous lookup helper. Reads the `usePgPartman` zustand
// store directly so callers can resolve a parent record inside a render loop
// without re-querying.
import { type PartmanParent, usePgPartman } from "./store";

export function getPartmanParent(
  connId: string,
  schema: string,
  table: string,
): PartmanParent | null {
  const map = usePgPartman.getState().parents.get(connId);
  return map?.get(`${schema}/${table}`) ?? null;
}
