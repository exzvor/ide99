/**
 * — McpAuthorizeDialog Vitest tests.
 *
 * Emulates a backend `mcp:authorize-request` Tauri event by capturing
 * the registered listener through a mocked `@tauri-apps/api/event`,
 * then asserts the dialog renders with the requested scopes and that
 * each action button calls the right backend command.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpAuthorizeDialog } from "../McpAuthorizeDialog";

// ─── Mocks ────────────────────────────────────────────────────────────────

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type Listener = (event: { payload: unknown }) => void;
const eventListeners = new Map<string, Set<Listener>>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, cb: Listener) => {
    let bucket = eventListeners.get(eventName);
    if (!bucket) {
      bucket = new Set();
      eventListeners.set(eventName, bucket);
    }
    bucket.add(cb);
    return () => {
      bucket?.delete(cb);
    };
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "settings.mcp.authorize.title": "Authorize MCP client",
        "settings.mcp.authorize.requesting": "{{client}} is requesting access",
        "settings.mcp.authorize.scopesHeading": "Requested scopes",
        "settings.mcp.authorize.allow": "Allow",
        "settings.mcp.authorize.allowReadOnly": "Allow read-only",
        "settings.mcp.authorize.allowWithWrite": "Allow with write",
        "settings.mcp.authorize.deny": "Deny",
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

async function fireAuthorize(payload: unknown): Promise<void> {
  await act(async () => {
    // Wait one microtask so the async listen() registration finishes.
    await Promise.resolve();
    const bucket = eventListeners.get("mcp:authorize-request");
    bucket?.forEach((cb) => cb({ payload }));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("McpAuthorizeDialog", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    eventListeners.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing without an event", () => {
    const { container } = render(<McpAuthorizeDialog />);
    expect(container.textContent).toBe("");
  });

  it("renders with client name + scopes when event fires", async () => {
    render(<McpAuthorizeDialog />);
    await fireAuthorize({
      requestId: "req-1",
      clientName: "Claude Code",
      requestedScopes: ["db-read", "ide-read"],
    });
    expect(await screen.findByText(/Claude Code is requesting access/)).toBeInTheDocument();
    expect(screen.getByText("db-read")).toBeInTheDocument();
    expect(screen.getByText("ide-read")).toBeInTheDocument();
  });

  it("Allow button calls mcp_authorize_response with default grant", async () => {
    const user = userEvent.setup();
    render(<McpAuthorizeDialog />);
    await fireAuthorize({
      requestId: "req-2",
      clientName: "Cursor",
      requestedScopes: ["db-read"],
    });
    await user.click(await screen.findByTestId("mcp-authorize-allow"));
    expect(invokeMock).toHaveBeenCalledWith("mcp_authorize_response", {
      requestId: "req-2",
      scopes: ["db-read", "ide-read", "ide-write"],
    });
  });

  it("Deny button calls mcp_authorize_deny", async () => {
    const user = userEvent.setup();
    render(<McpAuthorizeDialog />);
    await fireAuthorize({
      requestId: "req-3",
      clientName: "Claude Code",
      requestedScopes: ["db-read"],
    });
    await user.click(await screen.findByTestId("mcp-authorize-deny"));
    expect(invokeMock).toHaveBeenCalledWith("mcp_authorize_deny", { requestId: "req-3" });
  });

  it("Allow read-only sends a minimal scope set", async () => {
    const user = userEvent.setup();
    render(<McpAuthorizeDialog />);
    await fireAuthorize({
      requestId: "req-4",
      clientName: "Cursor",
      requestedScopes: ["db-read", "db-write"],
    });
    await user.click(await screen.findByTestId("mcp-authorize-read-only"));
    expect(invokeMock).toHaveBeenCalledWith("mcp_authorize_response", {
      requestId: "req-4",
      scopes: ["db-read", "ide-read"],
    });
  });
});
