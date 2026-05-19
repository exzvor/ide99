/**
 * — SettingsMcp Vitest tests.
 *
 * Mocks `@tauri-apps/api/core` invoke() to canned responses for each
 * IPC command, then asserts:
 * - enable toggle flips the backend status;
 * - revoke removes a row optimistically;
 * - copy-to-clipboard copies the right snippet.
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsMcp } from "../SettingsMcp";

// ─── Mocks ────────────────────────────────────────────────────────────────

interface InvokeArgs {
  enabled?: boolean;
  clientId?: string;
}

const invokeMock = vi.fn(async (cmd: string, _args?: InvokeArgs) => {
  switch (cmd) {
    case "mcp_get_status":
      return {
        enabled: true,
        httpPort: 51789,
        ipcSocket: null,
        authorizedClients: 1,
      };
    case "mcp_set_enabled":
      return {
        enabled: _args?.enabled ?? false,
        httpPort: _args?.enabled ? 51789 : null,
        ipcSocket: null,
        authorizedClients: 0,
      };
    case "mcp_list_clients":
      return [
        {
          id: "client-1",
          name: "Claude Code",
          scopes: ["db-read", "ide-read"],
          createdAt: "2026-05-01T10:00:00Z",
          lastUsedAt: "2026-05-05T12:34:56Z",
        },
      ];
    case "mcp_revoke_client":
      return null;
    case "mcp_get_config_snippet":
      return {
        claudeCode: '{"mcpServers":{"ide99":{"command":"ide99-mcp"}}}',
        cursor: '{"mcpServers":{"ide99":{"command":"ide99-mcp"}}}',
      };
    default:
      throw new Error(`Unmocked command: ${cmd}`);
  }
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1] as InvokeArgs | undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "settings.mcp.title": "MCP server",
        "settings.mcp.description": "Expose ide99 to your AI agent.",
        "settings.mcp.loading": "Loading…",
        "settings.mcp.enableLabel": "Enable MCP server",
        "settings.mcp.runningOnPort": "Running on 127.0.0.1:{{port}}",
        "settings.mcp.authorizedClients": "Authorized clients",
        "settings.mcp.noClients": "No clients",
        "settings.mcp.revoke": "Revoke",
        "settings.mcp.lastUsed": "Last used: {{when}}",
        "settings.mcp.lastUsedNever": "Never used",
        "settings.mcp.connectAgent": "Connect your agent",
        "settings.mcp.connectAgentHint": "Add ide99 as MCP server.",
        "settings.mcp.connect.claudeCode": "Add to Claude Code",
        "settings.mcp.connect.cursor": "Add to Cursor",
        "settings.mcp.connect.copy": "Copy",
        "settings.mcp.connect.copied": "Copied!",
        "settings.mcp.connect.enableFirst": "Enable first.",
        "settings.mcp.connect.readGuide": "Read the full MCP guide",
      };
      let template = dict[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          template = template.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
        }
      }
      return template;
    },
  }),
}));

// ─── Test ─────────────────────────────────────────────────────────────────

describe("SettingsMcp", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders status, port info, and authorized client", async () => {
    render(<SettingsMcp />);
    await waitFor(() => expect(screen.getByText(/Authorized clients/i)).toBeInTheDocument());
    expect(screen.getByText(/Running on 127.0.0.1:51789/)).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText(/db-read, ide-read/)).toBeInTheDocument();
  });

  it("toggle enable invokes mcp_set_enabled", async () => {
    const user = userEvent.setup();
    render(<SettingsMcp />);
    const toggle = await screen.findByTestId("mcp-enable-toggle");
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("mcp_set_enabled", { enabled: false }),
);
  });

  it("revoke removes the client row optimistically", async () => {
    const user = userEvent.setup();
    render(<SettingsMcp />);
    await screen.findByText("Claude Code");
    await user.click(screen.getByTestId("mcp-revoke-client-1"));
    await waitFor(() => expect(screen.queryByText("Claude Code")).not.toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("mcp_revoke_client", { clientId: "client-1" });
  });

  it("copy button writes to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    render(<SettingsMcp />);
    const btn = await screen.findByTestId("mcp-copy-claude");
    // Use fireEvent rather than userEvent — userEvent v14 installs its
    // own clipboard stub that swallows our spy.
    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith('{"mcpServers":{"ide99":{"command":"ide99-mcp"}}}');
  });
});
