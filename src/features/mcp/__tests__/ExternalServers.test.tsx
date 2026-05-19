/**
 * — ExternalServers smoke tests.
 *
 * Mocks the IPC layer to verify list rendering, connect/disconnect flow,
 * empty state, and reload action.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../components/Toast";
import i18n from "../../../i18n";
import { ExternalServers } from "../ExternalServers";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const { invoke } = await import("@tauri-apps/api/core");

function renderUI() {
  return render(    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <ExternalServers />
      </ToastProvider>
    </I18nextProvider>,
);
}

describe("ExternalServers", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows empty state when no servers configured", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "mcp_client_list") return [];
      if (cmd === "mcp_client_config_path") return "/tmp/mcp-servers.json";
      throw new Error(`unexpected ${cmd}`);
    });
    renderUI();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(      screen.getByText(/No external MCP servers configured|Внешних MCP-серверов не настроено/i),
).toBeInTheDocument();
  });

  it("renders rows with status and tool counts", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "mcp_client_list") {
        return [
          {
            config: {
              name: "linear",
              transport: "stdio",
              displayTarget: "npx -y @linear/mcp-server",
              autoStart: true,
            },
            status: {
              kind: "connected",
              tools: [
                { name: "list_issues", description: "List Linear issues" },
                { name: "create_issue" },
              ],
              resources: [],
              serverName: "linear-mcp",
              protocolVersion: "2024-11-05",
            },
          },
        ];
      }
      if (cmd === "mcp_client_config_path") return "/tmp/mcp-servers.json";
      throw new Error(`unexpected ${cmd}`);
    });
    renderUI();
    await waitFor(() => expect(screen.getByText("linear")).toBeInTheDocument());
    expect(screen.getByText(/npx -y @linear\/mcp-server/)).toBeInTheDocument();
    expect(screen.getByText(/2 tools/)).toBeInTheDocument();
  });

  it("calls disconnect command when Disconnect clicked on connected row", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "mcp_client_list") {
        return [
          {
            config: {
              name: "linear",
              transport: "stdio",
              displayTarget: "npx -y @linear/mcp-server",
              autoStart: true,
            },
            status: {
              kind: "connected",
              tools: [],
              resources: [],
            },
          },
        ];
      }
      if (cmd === "mcp_client_config_path") return "/tmp/mcp-servers.json";
      if (cmd === "mcp_client_disconnect") return undefined;
      throw new Error(`unexpected ${cmd}`);
    });
    renderUI();
    await waitFor(() => expect(screen.getByText("linear")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("mcp-external-disconnect-linear"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("mcp_client_disconnect", { name: "linear" }),
);
  });

  it("calls reload command on Reload click", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "mcp_client_list") return [];
      if (cmd === "mcp_client_config_path") return "/tmp/mcp-servers.json";
      if (cmd === "mcp_client_reload") return undefined;
      throw new Error(`unexpected ${cmd}`);
    });
    renderUI();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId("mcp-external-reload"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("mcp_client_reload"));
  });
});
