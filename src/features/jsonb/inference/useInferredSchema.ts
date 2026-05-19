import { useEffect, useMemo } from "react";

import type { Fqn } from "../../../lib/tauri";

import { useJsonbInference } from "./store";
import { type Entry, fqnKey } from "./types";

/**
 * — React hook that:
 * 1. Initializes the inference store on first mount (idempotent).
 * 2. Triggers a `request` for the given (connId, fqn).
 * 3. Returns the current Entry; component re-renders when the store updates.
 */
export function useInferredSchema(connId: string, fqn: Fqn): Entry {
  const init = useJsonbInference((s) => s.init);
  const request = useJsonbInference((s) => s.request);
  const key = useMemo(() => fqnKey(connId, fqn), [connId, fqn.schema, fqn.table, fqn.column]);
  const entry = useJsonbInference((s) => s.byKey[key]);

  useEffect(() => {
    void init();
    request(connId, fqn);
  }, [init, request, connId, fqn.schema, fqn.table, fqn.column]);

  return entry ?? { status: "pending" };
}
