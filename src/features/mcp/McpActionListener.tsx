/**
 * Invisible component mounted at the App level.
 *
 * Listens for the Tauri event `mcp:action`, parses the payload, and
 * dispatches a local `ide99:*` CustomEvent for feature listeners
 * (editor, schema tree, object editor). This decouples dependencies:
 * the backend only knows about an "MCP action", while frontend features
 * keep listening on their own domain bus.
 */

import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { type JSX, useEffect } from "react";
import { useToast } from "../../components/Toast";
import { type McpActionEvent, mcpActionEventSchema } from "./api";

function dispatchAction(action: McpActionEvent): void {
  switch (action.kind) {
    case "open-query":
      window.dispatchEvent(        new CustomEvent("ide99:open-query", {
          detail: { sql: action.sql, connId: action.connId },
        }),
);
      break;
    case "run-query":
      window.dispatchEvent(        new CustomEvent("ide99:open-query", {
          detail: { sql: action.sql, connId: action.connId },
        }),
);
      window.dispatchEvent(        new CustomEvent("ide99:run-query", {
          detail: { sql: action.sql, connId: action.connId },
        }),
);
      break;
    case "open-table":
      window.dispatchEvent(        new CustomEvent("ide99:open-object-editor", {
          detail: {
            connId: action.connId,
            schema: action.schema,
            table: action.table,
            kind: "table",
          },
        }),
);
      break;
    case "open-explain":
      window.dispatchEvent(        new CustomEvent("ide99:open-explain", {
          detail: { connId: action.connId, sql: action.sql },
        }),
);
      break;
    case "navigate-tree":
      window.dispatchEvent(        new CustomEvent("ide99:focus-tree-node", {
          detail: {
            connId: action.connId,
            schema: action.schema,
            table: action.table,
          },
        }),
);
      break;
  }
}

export function McpActionListener(): JSX.Element | null {
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    let off: UnlistenFn | null = null;
    void (async () => {
      const u = await listen<unknown>("mcp:action", (event) => {
        const parsed = mcpActionEventSchema.safeParse(event.payload);
        if (!parsed.success) {
          toast.error(`mcp:action: ${parsed.error.message}`);
          return;
        }
        dispatchAction(parsed.data);
      });
      if (cancelled) {
        u();
        return;
      }
      off = u;
    })();
    return () => {
      cancelled = true;
      if (off) off();
    };
    // toast is stable
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable
  }, []);

  return null;
}
