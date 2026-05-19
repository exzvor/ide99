import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { translation } = vi.hoisted(() => {
  const t = (key: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts === "object") {
      return Object.entries(opts).reduce<string>(        (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)),
        key,
);
    }
    return key;
  };
  return {
    translation: {
      t,
      i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => translation,
}));

const { errorMock, successMock, toastApi } = vi.hoisted(() => {
  const errorMock = vi.fn();
  const successMock = vi.fn();
  const infoMock = vi.fn();
  const warningMock = vi.fn();
  return {
    errorMock,
    successMock,
    toastApi: { success: successMock, error: errorMock, info: infoMock, warning: warningMock },
  };
});
vi.mock("../../components/Toast", () => ({
  useToast: () => toastApi,
}));

const {
  schemaListColumnsMock,
  schemaListIndexesMock,
  schemaListForeignKeysMock,
  schemaListViewsMock,
} = vi.hoisted(() => ({
  schemaListColumnsMock: vi.fn(),
  schemaListIndexesMock: vi.fn(),
  schemaListForeignKeysMock: vi.fn(),
  schemaListViewsMock: vi.fn(),
}));

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    schemaListColumns: schemaListColumnsMock,
    schemaListIndexes: schemaListIndexesMock,
    schemaListForeignKeys: schemaListForeignKeysMock,
    schemaListViews: schemaListViewsMock,
  };
});

import { ObjectDetails } from "./ObjectDetails";
import { useSchema } from "./store";

const initialState = useSchema.getState();

beforeEach(() => {
  errorMock.mockReset();
  successMock.mockReset();
  schemaListColumnsMock.mockReset();
  schemaListIndexesMock.mockReset();
  schemaListForeignKeysMock.mockReset();
  schemaListViewsMock.mockReset();
  useSchema.setState(    {
      ...initialState,
      connection: {
        status: "connected",
        connId: "conn-1",
        serverVersion: "PostgreSQL 17",
        database: "appdb",
      },
      cache: new Map(),
      selectedNode: null,
      filter: "",
    },
    true,
);
});

describe("ObjectDetails", () => {
  test("renders the no-selection placeholder when node is null", () => {
    render(<ObjectDetails node={null} />);
    expect(screen.getByText("object_details.no_selection")).toBeInTheDocument();
  });

  test("renders the no-selection placeholder for schema or group nodes", () => {
    render(<ObjectDetails node="schema:public" />);
    expect(screen.getByText("object_details.no_selection")).toBeInTheDocument();
  });

  test("renders Columns tab as default for table and shows fetched rows", async () => {
    schemaListColumnsMock.mockResolvedValueOnce([
      {
        name: "id",
        dataType: "bigint",
        nullable: false,
        default: "nextval('users_id_seq'::regclass)",
        comment: null,
        ordinal: 1,
      },
      {
        name: "email",
        dataType: "text",
        nullable: false,
        default: null,
        comment: "Login email",
        ordinal: 2,
      },
    ]);

    render(<ObjectDetails node="table:public/users" />);

    expect(await screen.findByText("id")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("bigint")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByText("Login email")).toBeInTheDocument();
    expect(schemaListColumnsMock).toHaveBeenCalledWith("conn-1", "public", "users");
  });

  test("switching to Indexes tab triggers fetch and renders rows", async () => {
    schemaListColumnsMock.mockResolvedValueOnce([]);
    schemaListIndexesMock.mockResolvedValueOnce([
      {
        name: "users_pkey",
        method: "btree",
        isUnique: true,
        isPrimary: true,
        definition: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)",
      },
    ]);

    const user = userEvent.setup();
    render(<ObjectDetails node="table:public/users" />);

    // Wait for initial columns fetch to settle
    await waitFor(() => expect(schemaListColumnsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: "object_details.section.indexes" }));

    expect(await screen.findByText("users_pkey")).toBeInTheDocument();
    expect(screen.getByText("btree")).toBeInTheDocument();
    expect(schemaListIndexesMock).toHaveBeenCalledWith("conn-1", "public", "users");
  });

  test("switching to Foreign Keys tab triggers fetch and renders rows", async () => {
    schemaListColumnsMock.mockResolvedValueOnce([]);
    schemaListForeignKeysMock.mockResolvedValueOnce([
      {
        name: "orders_user_id_fkey",
        definition: "FOREIGN KEY (user_id) REFERENCES public.users(id)",
        referencedSchema: "public",
        referencedTable: "users",
      },
    ]);

    const user = userEvent.setup();
    render(<ObjectDetails node="table:public/orders" />);

    await waitFor(() => expect(schemaListColumnsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: "object_details.section.foreign_keys" }));

    expect(await screen.findByText("orders_user_id_fkey")).toBeInTheDocument();
    // The "→ public.users" reference label appears as standalone text.
    expect(screen.getByText("→ public.users")).toBeInTheDocument();
    expect(schemaListForeignKeysMock).toHaveBeenCalledWith("conn-1", "public", "orders");
  });

  test("renders Definition tab for view and shows fetched view definition", async () => {
    schemaListViewsMock.mockResolvedValueOnce([
      {
        name: "active_users",
        definition: " SELECT * FROM users;",
        comment: null,
      },
    ]);

    render(<ObjectDetails node="view:public/active_users" />);

    expect(await screen.findByText(/SELECT \* FROM users/)).toBeInTheDocument();
    expect(schemaListViewsMock).toHaveBeenCalledWith("conn-1", "public");
  });

  test("shows loading state while fetching", () => {
    schemaListColumnsMock.mockReturnValueOnce(new Promise(() => {}));
    render(<ObjectDetails node="table:public/users" />);
    expect(screen.getByText("schema.connecting")).toBeInTheDocument();
  });

  test("shows error message and Retry button on fetch failure", async () => {
    schemaListColumnsMock.mockRejectedValueOnce(new Error("boom"));
    render(<ObjectDetails node="table:public/users" />);

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "schema.refresh" })).toBeInTheDocument();
    expect(errorMock).toHaveBeenCalledWith("boom");
  });

  test("returns no-selection placeholder when not connected", () => {
    useSchema.setState({ connection: { status: "idle" } });
    render(<ObjectDetails node="table:public/users" />);
    expect(screen.getByText("object_details.no_selection")).toBeInTheDocument();
    expect(schemaListColumnsMock).not.toHaveBeenCalled();
  });
});
