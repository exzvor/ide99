import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Connection } from "../../lib/tauri";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        return Object.entries(opts).reduce<string>(
          (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)),
          key,
        );
      }
      return key;
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

const successMock = vi.fn();
const errorMock = vi.fn();
vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: successMock, error: errorMock }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const deleteConnectionMock = vi.fn();
const duplicateConnectionMock = vi.fn();
vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    deleteConnection: (id: string) => deleteConnectionMock(id),
    duplicateConnection: (id: string) => duplicateConnectionMock(id),
  };
});

import { useConnections } from "./store";

const initialState = useConnections.getState();

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: overrides.id ?? "id-1",
    name: overrides.name ?? "alpha",
    host: overrides.host ?? "localhost",
    port: overrides.port ?? 5432,
    database: overrides.database ?? "postgres",
    username: overrides.username ?? "postgres",
    sslMode: overrides.sslMode ?? "prefer",
    hasPassword: overrides.hasPassword ?? false,
    createdAt: overrides.createdAt ?? "2026-04-27T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-27T00:00:00Z",
    lastTestedAt: overrides.lastTestedAt ?? null,
    lastTestOk: overrides.lastTestOk ?? null,
    excludeFromHistory: overrides.excludeFromHistory ?? false,
    excludeFromRecentPlans: overrides.excludeFromRecentPlans ?? false,
    environment: overrides.environment ?? "local",
    readOnly: overrides.readOnly ?? false,
    slowQueryWarning: overrides.slowQueryWarning ?? false,
    confirmDestructive: overrides.confirmDestructive ?? false,
  };
}

beforeEach(() => {
  successMock.mockReset();
  errorMock.mockReset();
  deleteConnectionMock.mockReset();
  duplicateConnectionMock.mockReset();
  useConnections.setState(
    {
      ...initialState,
      connections: [],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    },
    true,
  );
});

import { ConnectionList } from "./ConnectionList";

describe("ConnectionList", () => {
  test("renders a list with aria-label", () => {
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha" })],
    });
    render(<ConnectionList />);
    expect(screen.getByRole("listbox", { name: "connection.list.aria_label" })).toBeInTheDocument();
  });

  test("renders each connection's name and host:port", () => {
    useConnections.setState({
      connections: [
        makeConnection({ id: "a", name: "alpha", host: "h1", port: 5432 }),
        makeConnection({ id: "b", name: "beta", host: "h2", port: 6543 }),
      ],
    });
    render(<ConnectionList />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("h1:5432")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("h2:6543")).toBeInTheDocument();
  });

  test("clicking a row selects it", async () => {
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha" })],
    });
    const user = userEvent.setup();
    render(<ConnectionList />);

    await user.click(screen.getByRole("option", { name: /alpha/ }));

    expect(useConnections.getState().selectedId).toBe("a");
  });

  test("right-click shows context menu with Edit/Duplicate/Delete", () => {
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha" })],
    });
    render(<ConnectionList />);

    const row = screen.getByRole("option", { name: /alpha/ });
    fireEvent.contextMenu(row);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("connection.list.context.edit")).toBeInTheDocument();
    expect(within(menu).getByText("connection.list.context.duplicate")).toBeInTheDocument();
    expect(within(menu).getByText("connection.list.context.delete")).toBeInTheDocument();
  });

  test("Edit menu item opens edit form", () => {
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha" })],
    });
    render(<ConnectionList />);

    fireEvent.contextMenu(screen.getByRole("option", { name: /alpha/ }));
    fireEvent.click(screen.getByText("connection.list.context.edit"));

    expect(useConnections.getState().formMode).toEqual({ type: "edit", id: "a" });
  });

  test("Duplicate calls duplicateConnection (server-side copy with password) and updates store", async () => {
    const conn = makeConnection({ id: "a", name: "alpha" });
    const dup = makeConnection({ id: "a-dup", name: "alpha copy" });
    duplicateConnectionMock.mockResolvedValueOnce(dup);
    useConnections.setState({ connections: [conn] });
    render(<ConnectionList />);

    fireEvent.contextMenu(screen.getByRole("option", { name: /alpha/ }));
    fireEvent.click(screen.getByText("connection.list.context.duplicate"));

    await new Promise((r) => setTimeout(r, 0));

    expect(duplicateConnectionMock).toHaveBeenCalledWith("a");
    expect(successMock).toHaveBeenCalledWith("toast.connection.duplicated");
  });

  test("Delete opens confirm dialog with type-to-confirm", () => {
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha" })],
    });
    render(<ConnectionList />);

    fireEvent.contextMenu(screen.getByRole("option", { name: /alpha/ }));
    fireEvent.click(screen.getByText("connection.list.context.delete"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("connection.delete.confirm.title")).toBeInTheDocument();
  });

  test("Delete confirm requires typing the name then deletes", async () => {
    deleteConnectionMock.mockResolvedValueOnce(undefined);
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha" })],
    });
    const user = userEvent.setup();
    render(<ConnectionList />);

    fireEvent.contextMenu(screen.getByRole("option", { name: /alpha/ }));
    fireEvent.click(screen.getByText("connection.list.context.delete"));

    const confirmInput = screen.getByLabelText(/connection.delete.confirm.type_prompt/);
    const deleteBtn = screen.getByRole("button", { name: "connection.list.context.delete" });
    expect(deleteBtn).toBeDisabled();

    await user.type(confirmInput, "alpha");
    expect(deleteBtn).toBeEnabled();
    await user.click(deleteBtn);

    await new Promise((r) => setTimeout(r, 0));
    expect(deleteConnectionMock).toHaveBeenCalledWith("a");
    expect(successMock).toHaveBeenCalledWith("toast.connection.deleted");
  });

  test("ArrowDown/ArrowUp moves selection", async () => {
    useConnections.setState({
      connections: [
        makeConnection({ id: "a", name: "alpha" }),
        makeConnection({ id: "b", name: "beta" }),
        makeConnection({ id: "c", name: "gamma" }),
      ],
      selectedId: "a",
    });
    render(<ConnectionList />);

    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(useConnections.getState().selectedId).toBe("b");

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(useConnections.getState().selectedId).toBe("c");

    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(useConnections.getState().selectedId).toBe("b");
  });

  test("Enter on selected row opens edit", () => {
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha" })],
      selectedId: "a",
    });
    render(<ConnectionList />);

    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "Enter" });

    expect(useConnections.getState().formMode).toEqual({ type: "edit", id: "a" });
  });

  test("Delete key on selected row opens confirm dialog", () => {
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha" })],
      selectedId: "a",
    });
    render(<ConnectionList />);

    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "Delete" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("mounts 100 rows in under 200ms", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      makeConnection({ id: `id-${i}`, name: `conn-${String(i).padStart(3, "0")}` }),
    );
    useConnections.setState({ connections: many });

    const start = performance.now();
    render(<ConnectionList />);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(screen.getAllByRole("option")).toHaveLength(100);
  });

  // --- Task 18 — env badge per row ---

  test("renders env badge per row matching the row's environment", () => {
    useConnections.setState({
      connections: [
        makeConnection({ id: "a", name: "alpha-prod", environment: "prod" }),
        makeConnection({ id: "b", name: "beta-local", environment: "local" }),
        makeConnection({ id: "c", name: "gamma-stage", environment: "stage" }),
      ],
    });
    const { container } = render(<ConnectionList />);

    expect(container.querySelector(".env-badge.prod")).toBeInTheDocument();
    expect(container.querySelector(".env-badge.local")).toBeInTheDocument();
    expect(container.querySelector(".env-badge.stage")).toBeInTheDocument();
    expect(container.querySelector(".env-badge.dev")).toBeNull();
  });

  test("local connection still renders a badge (visually faded via CSS opacity)", () => {
    useConnections.setState({
      connections: [makeConnection({ id: "a", name: "alpha", environment: "local" })],
    });
    const { container } = render(<ConnectionList />);

    // Even for env=local the badge is in the DOM; CSS handles the opacity.
    expect(container.querySelector(".env-badge.local")).toBeInTheDocument();
  });
});
