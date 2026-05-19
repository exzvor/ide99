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
vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    deleteConnection: (id: string) => deleteConnectionMock(id),
  };
});

vi.mock("./TestButton", () => ({
  TestButton: ({ connectionId, variant }: { connectionId?: string; variant?: string }) => (
    <button type="button" data-testid="test-button" data-conn={connectionId} data-variant={variant}>
      test-button
    </button>
  ),
}));

import { useSchema } from "../schema/store";
import { useConnections } from "./store";

const initialState = useConnections.getState();
const initialSchemaState = useSchema.getState();
const schemaConnectMock = vi.fn();
const schemaDisconnectMock = vi.fn();

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
  schemaConnectMock.mockReset();
  schemaDisconnectMock.mockReset();
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
  useSchema.setState(
    {
      ...initialSchemaState,
      connection: { status: "idle" },
      cache: new Map(),
      selectedNode: null,
      filter: "",
      connect: schemaConnectMock,
      disconnect: schemaDisconnectMock,
    },
    true,
  );
});

import { ConnectionDetails } from "./ConnectionDetails";

describe("ConnectionDetails", () => {
  test("shows the no-selection hint when nothing is selected", () => {
    render(<ConnectionDetails />);
    expect(screen.getByText("connection.details.no_selection")).toBeInTheDocument();
  });

  test("renders host/port/database/user/sslmode for the selected connection", () => {
    const conn = makeConnection({
      id: "a",
      name: "alpha",
      host: "db.example.com",
      port: 5432,
      database: "app",
      username: "rw",
      sslMode: "require",
      lastTestedAt: null,
    });
    useConnections.setState({ connections: [conn], selectedId: "a" });

    render(<ConnectionDetails />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("db.example.com")).toBeInTheDocument();
    expect(screen.getByText("5432")).toBeInTheDocument();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByText("rw")).toBeInTheDocument();
    expect(screen.getByText("require")).toBeInTheDocument();
  });

  test("shows last test status when available", () => {
    const conn = makeConnection({
      id: "a",
      name: "alpha",
      lastTestedAt: new Date(Date.now() - 60_000).toISOString(),
      lastTestOk: true,
      excludeFromHistory: false,
      excludeFromRecentPlans: false,
      environment: "local",
      readOnly: false,
      slowQueryWarning: false,
      confirmDestructive: false,
    });
    useConnections.setState({ connections: [conn], selectedId: "a" });

    render(<ConnectionDetails />);

    expect(screen.getByText("connection.details.last_test.ok")).toBeInTheDocument();
  });

  test("shows 'never tested' when lastTestedAt is null", () => {
    const conn = makeConnection({ id: "a", lastTestedAt: null });
    useConnections.setState({ connections: [conn], selectedId: "a" });

    render(<ConnectionDetails />);

    expect(screen.getByText("connection.details.last_test.never")).toBeInTheDocument();
  });

  test("clicking Edit opens edit form", async () => {
    const conn = makeConnection({ id: "a" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    const user = userEvent.setup();
    render(<ConnectionDetails />);

    await user.click(screen.getByRole("button", { name: "connection.details.edit" }));

    expect(useConnections.getState().formMode).toEqual({ type: "edit", id: "a" });
  });

  test("clicking Delete opens confirm dialog", () => {
    const conn = makeConnection({ id: "a", name: "alpha" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    render(<ConnectionDetails />);

    fireEvent.click(screen.getByRole("button", { name: "connection.details.delete" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("confirm delete removes the connection from the store", async () => {
    deleteConnectionMock.mockResolvedValueOnce(undefined);
    const conn = makeConnection({ id: "a", name: "alpha" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    const user = userEvent.setup();
    render(<ConnectionDetails />);

    await user.click(screen.getByRole("button", { name: "connection.details.delete" }));
    const confirmInput = screen.getByLabelText(/connection.delete.confirm.type_prompt/);
    await user.type(confirmInput, "alpha");
    // After dialog opens, two buttons share the "delete" name (outer trigger
    // + dialog confirm). The dialog's lives inside role="dialog".
    const dialog = screen.getByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", {
      name: "connection.details.delete",
    });
    await user.click(confirmBtn);
    await new Promise((r) => setTimeout(r, 0));

    expect(deleteConnectionMock).toHaveBeenCalledWith("a");
    expect(successMock).toHaveBeenCalledWith("toast.connection.deleted");
  });

  test("renders the saved-mode TestButton", () => {
    const conn = makeConnection({ id: "a" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    render(<ConnectionDetails />);

    const btn = screen.getByTestId("test-button");
    expect(btn).toHaveAttribute("data-conn", "a");
    expect(btn).toHaveAttribute("data-variant", "saved");
  });

  test("Connect button is visible when no active connection", () => {
    const conn = makeConnection({ id: "a" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    render(<ConnectionDetails />);

    expect(screen.getByRole("button", { name: "connection.action.connect" })).toBeInTheDocument();
  });

  test("Disconnect button is visible when this connection is the connected one", () => {
    const conn = makeConnection({ id: "a" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "a",
        serverVersion: "PostgreSQL 17",
        database: "appdb",
      },
    });
    render(<ConnectionDetails />);

    expect(
      screen.getByRole("button", { name: "connection.action.disconnect" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "connection.action.connect" }),
    ).not.toBeInTheDocument();
  });

  test("Connecting label is visible while in-flight for this connection", () => {
    const conn = makeConnection({ id: "a" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    useSchema.setState({
      connection: { status: "connecting", connId: "a" },
    });
    render(<ConnectionDetails />);

    const btn = screen.getByRole("button", { name: "connection.connecting" });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  test("Connect button calls useSchema().connect with the selected id", async () => {
    const conn = makeConnection({ id: "a" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    const user = userEvent.setup();
    render(<ConnectionDetails />);

    await user.click(screen.getByRole("button", { name: "connection.action.connect" }));

    expect(schemaConnectMock).toHaveBeenCalledWith("a");
  });

  test("Connect button is disabled when another connection is in-flight", () => {
    const conn = makeConnection({ id: "a" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    useSchema.setState({
      connection: { status: "connecting", connId: "other" },
    });
    render(<ConnectionDetails />);

    const btn = screen.getByRole("button", { name: "connection.action.connect" });
    expect(btn).toBeDisabled();
  });

  test("Disconnect button calls useSchema().disconnect", async () => {
    const conn = makeConnection({ id: "a" });
    useConnections.setState({ connections: [conn], selectedId: "a" });
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "a",
        serverVersion: "PostgreSQL 17",
        database: "appdb",
      },
    });
    const user = userEvent.setup();
    render(<ConnectionDetails />);

    await user.click(screen.getByRole("button", { name: "connection.action.disconnect" }));

    expect(schemaDisconnectMock).toHaveBeenCalledTimes(1);
  });
});
