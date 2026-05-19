/**
 * — McpWriteConfirmDialog Vitest tests.
 *
 * Same pattern as the authorize dialog: simulate a Tauri event payload,
 * check rendering, then assert Approve / Reject route to
 * `mcp_write_confirm_response` with the right `allow` flag.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpWriteConfirmDialog } from "../McpWriteConfirmDialog";

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
        "settings.mcp.writeConfirm.title": "Approve write?",
        "settings.mcp.writeConfirm.kindQuery": "query",
        "settings.mcp.writeConfirm.kindMigration": "migration",
        "settings.mcp.writeConfirm.clientWants": "{{client}} wants to run a {{kind}}",
        "settings.mcp.writeConfirm.approve": "Approve",
        "settings.mcp.writeConfirm.reject": "Reject",
        "settings.mcp.writeConfirm.approveAllForNext":
          "Approve all writes for next {{minutes}} min",
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

async function fireWriteConfirm(payload: unknown): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    const bucket = eventListeners.get("mcp:write-confirm-request");
    bucket?.forEach((cb) => cb({ payload }));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("McpWriteConfirmDialog", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    eventListeners.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing without an event", () => {
    const { container } = render(<McpWriteConfirmDialog />);
    expect(container.textContent).toBe("");
  });

  it("renders SQL preview with client name + kind", async () => {
    render(<McpWriteConfirmDialog />);
    await fireWriteConfirm({
      requestId: "wreq-1",
      clientName: "Claude Code",
      sql: "DELETE FROM users WHERE id = 7;",
      kind: "query",
    });
    expect(await screen.findByText(/Claude Code wants to run a query/)).toBeInTheDocument();
    expect(screen.getByText(/DELETE FROM users/)).toBeInTheDocument();
  });

  it("Approve sends allow=true", async () => {
    const user = userEvent.setup();
    render(<McpWriteConfirmDialog />);
    await fireWriteConfirm({
      requestId: "wreq-2",
      clientName: "Cursor",
      sql: "UPDATE x SET y = 1;",
      kind: "query",
    });
    await user.click(await screen.findByTestId("mcp-write-approve"));
    expect(invokeMock).toHaveBeenCalledWith("mcp_write_confirm_response", {
      requestId: "wreq-2",
      allow: true,
    });
  });

  it("Reject sends allow=false", async () => {
    const user = userEvent.setup();
    render(<McpWriteConfirmDialog />);
    await fireWriteConfirm({
      requestId: "wreq-3",
      clientName: "Claude",
      sql: "TRUNCATE users;",
      kind: "migration",
    });
    await user.click(await screen.findByTestId("mcp-write-reject"));
    expect(invokeMock).toHaveBeenCalledWith("mcp_write_confirm_response", {
      requestId: "wreq-3",
      allow: false,
    });
  });
});
