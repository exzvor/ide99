import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

const errorMock = vi.fn();
const successMock = vi.fn();
vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: successMock, error: errorMock }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const parseConnectionUriMock = vi.fn();
vi.mock("../../lib/parseConnectionUri", () => ({
  parseConnectionUri: (uri: string) => parseConnectionUriMock(uri),
}));

import { useConnections } from "./store";

const initialState = useConnections.getState();

beforeEach(() => {
  errorMock.mockReset();
  successMock.mockReset();
  parseConnectionUriMock.mockReset();
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

afterEach(() => {
  parseConnectionUriMock.mockReset();
});

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  test("renders add button and uri input (quiet redesign — no separate title/body)", () => {
    render(<EmptyState />);

    // Quiet redesign collapsed the explicit title/body to a single CTA-led
    // composition: [+ Add Connection] button + URI input. The hint above the
    // input is the URI label; there is no separate "title"/"body" copy.
    expect(screen.getByRole("button", { name: "welcome.no_connections.add" })).toBeInTheDocument();
    expect(screen.getByLabelText("welcome.no_connections.uri_label")).toBeInTheDocument();
  });

  test("clicking + Add opens the create form", async () => {
    const user = userEvent.setup();
    render(<EmptyState />);

    await user.click(screen.getByRole("button", { name: "welcome.no_connections.add" }));

    expect(useConnections.getState().formMode).toEqual({
      type: "create",
      prefill: undefined,
    });
  });

  test("Enter on a valid URI opens form with prefill", async () => {
    parseConnectionUriMock.mockResolvedValueOnce({
      host: "db.example.com",
      port: 5433,
      database: "app",
      username: "rw",
      password: "secret",
      sslMode: "require",
    });
    const user = userEvent.setup();
    render(<EmptyState />);

    const input = screen.getByLabelText("welcome.no_connections.uri_label");
    await user.type(input, "postgresql://rw:secret@db.example.com:5433/app{Enter}");

    expect(parseConnectionUriMock).toHaveBeenCalled();
    // Wait for the parse promise + state update to settle. Polling on the
    // store directly avoids relying on a copy element that the redesign
    // removed.
    await waitFor(() => {
      expect(useConnections.getState().formMode.type).toBe("create");
    });
    const mode = useConnections.getState().formMode;
    expect(mode.type).toBe("create");
    if (mode.type === "create") {
      expect(mode.prefill).toEqual({
        // Auto-derived from URI per fix; non-default port keeps the
        // `:5433` segment in the name so the user can tell similar hosts apart.
        name: "rw@db.example.com:5433/app",
        host: "db.example.com",
        port: 5433,
        database: "app",
        username: "rw",
        password: "secret",
        sslMode: "require",
      });
    }
  });

  test("blur on invalid URI emits an error toast and keeps form closed", async () => {
    parseConnectionUriMock.mockRejectedValueOnce(new Error("bad uri"));
    render(<EmptyState />);

    const input = screen.getByLabelText("welcome.no_connections.uri_label");
    fireEvent.change(input, { target: { value: "not a uri" } });
    fireEvent.blur(input);

    // Allow rejected promise to settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(errorMock).toHaveBeenCalledWith("toast.connection.uri_invalid");
    expect(useConnections.getState().formMode).toEqual({ type: "closed" });
  });

  test("blur on empty URI does nothing", () => {
    render(<EmptyState />);
    const input = screen.getByLabelText("welcome.no_connections.uri_label");

    fireEvent.blur(input);

    expect(parseConnectionUriMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });
});
