/**
 * Typed wrappers for MCP server IPC commands.
 *
 * Mirror `src-tauri/src/mcp/commands.rs`. Runtime validation via zod —
 * same pattern as `src/lib/tauri.ts`.
 *
 * Includes commands for the resolve flow (authorize / write-confirm /
 * audit log) and Tauri events for the bridge.
 */

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

// ---------- DTOs ----------

export const mcpScopeSchema = z.enum(["db-list", "db-read", "db-write", "ide-read", "ide-write"]);
export type McpScope = z.infer<typeof mcpScopeSchema>;

export const mcpServerStatusSchema = z.object({
  enabled: z.boolean(),
  httpPort: z.number().int().nullable(),
  ipcSocket: z.string().nullable(),
  authorizedClients: z.number().int().nonnegative(),
});
export type McpServerStatus = z.infer<typeof mcpServerStatusSchema>;

export const authorizedClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(mcpScopeSchema),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type AuthorizedClient = z.infer<typeof authorizedClientSchema>;

export const mcpConfigSnippetSchema = z.object({
  claudeCode: z.string(),
  cursor: z.string(),
});
export type McpConfigSnippet = z.infer<typeof mcpConfigSnippetSchema>;

// ---------- IDE bridge snapshot ----------

export const tabKindSchema = z.enum([
  "query",
  "object-editor",
  "health-screen",
  "live-ops",
  "erd",
  "migrations",
]);
export type TabKind = z.infer<typeof tabKindSchema>;

export const tabSnapshotSchema = z.object({
  id: z.string(),
  title: z.string(),
  connId: z.string().nullable(),
  kind: tabKindSchema,
});
export type TabSnapshot = z.infer<typeof tabSnapshotSchema>;

export const ideBridgeStateSchema = z.object({
  activeConnId: z.string().nullable(),
  editorContent: z.string(),
  editorSelection: z.tuple([z.number(), z.number()]).nullable(),
  lastQuery: z
    .object({
      sql: z.string(),
      connId: z.string(),
      startedAt: z.string(),
      durationMs: z.number(),
      rowCount: z.number().nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  lastResult: z
    .object({
      columns: z.array(z.string()),
      rows: z.array(z.array(z.unknown())),
      truncated: z.boolean(),
    })
    .nullable(),
  openTabs: z.array(tabSnapshotSchema),
  healthScreenVisible: z.boolean(),
});
export type IdeBridgeState = z.infer<typeof ideBridgeStateSchema>;

// ---------- event payloads ----------

export const authorizeRequestEventSchema = z.object({
  requestId: z.string(),
  clientName: z.string(),
  requestedScopes: z.array(mcpScopeSchema),
});
export type AuthorizeRequestEvent = z.infer<typeof authorizeRequestEventSchema>;

export const writeConfirmEventSchema = z.object({
  requestId: z.string(),
  clientName: z.string(),
  sql: z.string(),
  kind: z.enum(["query", "migration"]),
});
export type WriteConfirmEvent = z.infer<typeof writeConfirmEventSchema>;

export const clientConnectedEventSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
});
export type ClientConnectedEvent = z.infer<typeof clientConnectedEventSchema>;

export const clientDisconnectedEventSchema = z.object({
  clientId: z.string(),
});
export type ClientDisconnectedEvent = z.infer<typeof clientDisconnectedEventSchema>;

export const mcpActionEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open-query"), sql: z.string(), connId: z.string().nullable() }),
  z.object({ kind: z.literal("run-query"), sql: z.string(), connId: z.string().nullable() }),
  z.object({
    kind: z.literal("open-table"),
    connId: z.string(),
    schema: z.string(),
    table: z.string(),
  }),
  z.object({ kind: z.literal("open-explain"), connId: z.string(), sql: z.string() }),
  z.object({
    kind: z.literal("navigate-tree"),
    connId: z.string(),
    schema: z.string(),
    table: z.string().nullable(),
  }),
]);
export type McpActionEvent = z.infer<typeof mcpActionEventSchema>;

// ---------- audit log ----------

export const mcpAuditEntrySchema = z.record(z.unknown());
export type McpAuditEntry = z.infer<typeof mcpAuditEntrySchema>;

// ---------- commands ----------

export async function mcpGetStatus(): Promise<McpServerStatus> {
  const raw = await invoke("mcp_get_status");
  return mcpServerStatusSchema.parse(raw);
}

export async function mcpSetEnabled(enabled: boolean): Promise<McpServerStatus> {
  const raw = await invoke("mcp_set_enabled", { enabled });
  return mcpServerStatusSchema.parse(raw);
}

export async function mcpListClients(): Promise<AuthorizedClient[]> {
  const raw = await invoke("mcp_list_clients");
  return z.array(authorizedClientSchema).parse(raw);
}

export async function mcpRevokeClient(clientId: string): Promise<void> {
  await invoke("mcp_revoke_client", { clientId });
}

export async function mcpGetConfigSnippet(): Promise<McpConfigSnippet> {
  const raw = await invoke("mcp_get_config_snippet");
  return mcpConfigSnippetSchema.parse(raw);
}

export async function mcpBridgeUpdate(snapshot: IdeBridgeState): Promise<void> {
  await invoke("mcp_bridge_update", { snapshot });
}

// ---------- Phase B: resolve handlers ----------

export async function mcpAuthorizeResponse(requestId: string, scopes: McpScope[]): Promise<void> {
  await invoke("mcp_authorize_response", { requestId, scopes });
}

export async function mcpAuthorizeDeny(requestId: string): Promise<void> {
  await invoke("mcp_authorize_deny", { requestId });
}

export async function mcpWriteConfirmResponse(requestId: string, allow: boolean): Promise<void> {
  await invoke("mcp_write_confirm_response", { requestId, allow });
}

export async function mcpGetAuditLog(limit: number): Promise<McpAuditEntry[]> {
  const raw = await invoke("mcp_get_audit_log", { limit });
  return z.array(mcpAuditEntrySchema).parse(raw);
}

// ---------- outbound MCP client (external servers) ----------

const remoteToolSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
});
export type RemoteTool = z.infer<typeof remoteToolSchema>;

const remoteResourceSchema = z.object({
  uri: z.string(),
  name: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
});
export type RemoteResource = z.infer<typeof remoteResourceSchema>;

export const connectionStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disconnected") }),
  z.object({ kind: z.literal("connecting") }),
  z.object({
    kind: z.literal("connected"),
    tools: z.array(remoteToolSchema),
    resources: z.array(remoteResourceSchema),
    serverName: z.string().nullable().optional(),
    protocolVersion: z.string().nullable().optional(),
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const externalServerConfigSchema = z.object({
  name: z.string(),
  transport: z.string(),
  displayTarget: z.string(),
  autoStart: z.boolean(),
});
export type ExternalServerConfig = z.infer<typeof externalServerConfigSchema>;

export const mcpClientListItemSchema = z.object({
  config: externalServerConfigSchema,
  status: connectionStatusSchema,
});
export type McpClientListItem = z.infer<typeof mcpClientListItemSchema>;

export async function mcpClientList(): Promise<McpClientListItem[]> {
  const raw = await invoke("mcp_client_list");
  return z.array(mcpClientListItemSchema).parse(raw);
}

export async function mcpClientConnect(name: string): Promise<void> {
  await invoke("mcp_client_connect", { name });
}

export async function mcpClientDisconnect(name: string): Promise<void> {
  await invoke("mcp_client_disconnect", { name });
}

export async function mcpClientReload(): Promise<void> {
  await invoke("mcp_client_reload");
}

export async function mcpClientConfigPath(): Promise<string> {
  return z.string().parse(await invoke("mcp_client_config_path"));
}
