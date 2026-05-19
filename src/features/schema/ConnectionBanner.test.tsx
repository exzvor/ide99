import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

import { useConnections } from "../connections/store";
import { ConnectionBanner } from "./ConnectionBanner";
import { useSchema } from "./store";

const initialSchemaState = useSchema.getState();
const initialConnectionsState = useConnections.getState();

const disconnectMock = vi.fn();

beforeEach(() => {
  disconnectMock.mockReset();
  useSchema.setState(
    {
      ...initialSchemaState,
      connection: { status: "idle" },
      cache: new Map(),
      selectedNode: null,
      filter: "",
      disconnect: disconnectMock,
    },
    true,
  );
  useConnections.setState(
    {
      ...initialConnectionsState,
      connections: [],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    },
    true,
  );
});

describe("ConnectionBanner", () => {
  test("returns null when not connected", () => {
    const { container } = render(<ConnectionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders connection name + database when connected", () => {
    useConnections.setState({
      connections: [
        {
          id: "conn-1",
          name: "dev-myapp",
          host: "localhost",
          port: 5432,
          database: "appdb",
          username: "postgres",
          sslMode: "prefer",
          hasPassword: false,
          createdAt: "2026-04-27T00:00:00Z",
          updatedAt: "2026-04-27T00:00:00Z",
          lastTestedAt: null,
          lastTestOk: null,
          excludeFromHistory: false,
          excludeFromRecentPlans: false,
          environment: "local",
          readOnly: false,
          slowQueryWarning: false,
          confirmDestructive: false,
        },
      ],
    });
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-1",
        serverVersion: "PostgreSQL 17",
        database: "appdb",
      },
    });

    render(<ConnectionBanner />);

    expect(screen.getByText("dev-myapp")).toBeInTheDocument();
    expect(screen.getByText("appdb")).toBeInTheDocument();
    expect(screen.getByTestId("connection-banner-dot")).toBeInTheDocument();
  });

  test("Edit button calls openEditForm with the active connection id", async () => {
    useConnections.setState({
      connections: [
        {
          id: "conn-1",
          name: "dev-myapp",
          host: "localhost",
          port: 5432,
          database: "appdb",
          username: "postgres",
          sslMode: "prefer",
          hasPassword: false,
          createdAt: "2026-04-27T00:00:00Z",
          updatedAt: "2026-04-27T00:00:00Z",
          lastTestedAt: null,
          lastTestOk: null,
          excludeFromHistory: false,
          excludeFromRecentPlans: false,
          environment: "local",
          readOnly: false,
          slowQueryWarning: false,
          confirmDestructive: false,
        },
      ],
    });
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-1",
        serverVersion: "PostgreSQL 17",
        database: "appdb",
      },
    });

    const user = userEvent.setup();
    render(<ConnectionBanner />);

    await user.click(screen.getByRole("button", { name: "connection.banner.edit" }));

    expect(useConnections.getState().formMode).toEqual({ type: "edit", id: "conn-1" });
  });

  test("Disconnect button calls useSchema().disconnect", async () => {
    useConnections.setState({ connections: [] });
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-1",
        serverVersion: "PostgreSQL 17",
        database: "appdb",
      },
      disconnect: disconnectMock,
    });

    const user = userEvent.setup();
    render(<ConnectionBanner />);

    await user.click(screen.getByRole("button", { name: "connection.banner.disconnect" }));

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  test("falls back to connId as label when connection name is unknown", () => {
    useConnections.setState({ connections: [] });
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "unknown-id",
        serverVersion: "PostgreSQL 17",
        database: "appdb",
      },
    });

    render(<ConnectionBanner />);
    expect(screen.getByText("unknown-id")).toBeInTheDocument();
  });
});
