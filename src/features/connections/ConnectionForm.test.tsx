import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../lib/tauri";

beforeAll(() => {
  // Radix Select / Dialog internals — jsdom polyfills.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}::${JSON.stringify(opts)}` : key,
  }),
}));

const testConnectionMock = vi.fn();
const testConnectionForEditMock = vi.fn();
const createConnectionMock = vi.fn();
const updateConnectionMock = vi.fn();

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    testConnection: (input: unknown) => testConnectionMock(input),
    testConnectionForEdit: (id: string, input: unknown) => testConnectionForEditMock(id, input),
    createConnection: (input: unknown) => createConnectionMock(input),
    updateConnection: (id: string, input: unknown) => updateConnectionMock(id, input),
  };
});

interface MockState {
  formMode:
    | { type: "closed" }
    | { type: "create"; prefill?: unknown }
    | { type: "edit"; id: string };
  connections: Connection[];
  closeForm: ReturnType<typeof vi.fn>;
  upsertLocal: ReturnType<typeof vi.fn>;
}

let storeState: MockState;

vi.mock("./store", () => ({
  useConnections: <U,>(selector: (state: MockState) => U): U => selector(storeState),
}));

import { ToastProvider } from "../../components/Toast";
import { ConnectionForm } from "./ConnectionForm";

const baseConnection: Connection = {
  id: "conn-1",
  name: "existing",
  host: "db.example.com",
  port: 5432,
  database: "postgres",
  username: "u",
  sslMode: "prefer",
  hasPassword: true,
  createdAt: "2026-04-27T10:00:00Z",
  updatedAt: "2026-04-27T10:00:00Z",
  lastTestedAt: null,
  lastTestOk: null,
  excludeFromHistory: false,
  excludeFromRecentPlans: false,
  environment: "local",
  readOnly: false,
  slowQueryWarning: false,
  confirmDestructive: false,
};

function renderForm() {
  return render(
    <ToastProvider>
      <ConnectionForm />
    </ToastProvider>,
  );
}

describe("ConnectionForm", () => {
  beforeEach(() => {
    testConnectionMock.mockReset();
    testConnectionForEditMock.mockReset();
    createConnectionMock.mockReset();
    updateConnectionMock.mockReset();
    storeState = {
      formMode: { type: "create" },
      connections: [],
      closeForm: vi.fn(),
      upsertLocal: vi.fn(),
    };
  });

  it("renders nothing when formMode is closed", () => {
    storeState.formMode = { type: "closed" };
    renderForm();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("create mode: renders create title and required fields", () => {
    renderForm();
    expect(screen.getByText("connection.form.title.create")).toBeInTheDocument();
    expect(screen.getByLabelText(/connection.form.field.name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/connection.form.field.host/)).toBeInTheDocument();
  });

  it("Save is disabled until a successful test or 'Save without testing'", async () => {
    renderForm();
    const saveButton = screen.getByRole("button", { name: "connection.form.action.save" });
    expect(saveButton).toBeDisabled();

    const checkbox = screen.getByRole("checkbox", { name: /save_without_testing/ });
    await userEvent.click(checkbox);
    expect(saveButton).not.toBeDisabled();
  });

  it("required-field validation surfaces inline errors on submit", async () => {
    renderForm();

    // Tick "save without testing" to allow submit attempt with empty name.
    await userEvent.click(screen.getByRole("checkbox", { name: /save_without_testing/ }));
    // Clear default values so we hit 'required'.
    const nameInput = screen.getByLabelText(/connection.form.field.name/);
    await userEvent.clear(nameInput);
    const userInput = screen.getByLabelText(/connection.form.field.username/);
    await userEvent.clear(userInput);

    const saveButton = screen.getByRole("button", { name: "connection.form.action.save" });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("connection.form.error.name_required")).toBeInTheDocument();
    });
    expect(screen.getByText("connection.form.error.user_required")).toBeInTheDocument();
  });

  it("port range validation rejects 0 and >65535", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("checkbox", { name: /save_without_testing/ }));

    const portInput = screen.getByLabelText(/connection.form.field.port/);
    await userEvent.clear(portInput);
    await userEvent.type(portInput, "70000");

    // fill required string fields
    await userEvent.type(screen.getByLabelText(/connection.form.field.name/), "x");
    await userEvent.type(screen.getByLabelText(/connection.form.field.username/), "u");

    await userEvent.click(screen.getByRole("button", { name: "connection.form.action.save" }));

    await waitFor(() => {
      expect(screen.getByText("connection.form.error.port_invalid")).toBeInTheDocument();
    });
  });

  it("rejects a duplicate name when the store already has one", async () => {
    storeState.connections = [baseConnection];
    renderForm();
    await userEvent.click(screen.getByRole("checkbox", { name: /save_without_testing/ }));

    await userEvent.type(screen.getByLabelText(/connection.form.field.name/), "existing");
    await userEvent.type(screen.getByLabelText(/connection.form.field.username/), "u");
    await userEvent.click(screen.getByRole("button", { name: "connection.form.action.save" }));

    await waitFor(() => {
      expect(screen.getByText("connection.form.error.name_taken")).toBeInTheDocument();
    });
  });

  it("Test connection success enables Save and shows the badge", async () => {
    testConnectionMock.mockResolvedValueOnce({
      ok: true,
      durationMs: 87,
      error: null,
      serverVersion: "PostgreSQL 17.2",
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(/connection.form.field.name/), "test-conn");
    await userEvent.type(screen.getByLabelText(/connection.form.field.username/), "u");

    await userEvent.click(screen.getByRole("button", { name: "connection.form.action.test" }));

    await waitFor(() => {
      expect(screen.getByTestId("form-test-success")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "connection.form.action.save" })).not.toBeDisabled();
  });

  it("Test connection failure shows inline error block (Save still disabled)", async () => {
    testConnectionMock.mockResolvedValueOnce({
      ok: false,
      durationMs: 12,
      error: "connection refused",
      serverVersion: null,
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(/connection.form.field.name/), "test-conn");
    await userEvent.type(screen.getByLabelText(/connection.form.field.username/), "u");

    await userEvent.click(screen.getByRole("button", { name: "connection.form.action.test" }));

    await waitFor(() => {
      expect(screen.getByTestId("form-test-failure")).toBeInTheDocument();
    });
    expect(screen.getByText("connection refused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "connection.form.action.save" })).toBeDisabled();
  });

  it("edit mode: prefills from store and submits via updateConnection", async () => {
    storeState.formMode = { type: "edit", id: "conn-1" };
    storeState.connections = [baseConnection];
    updateConnectionMock.mockResolvedValueOnce({ ...baseConnection, name: "renamed" });

    renderForm();

    expect(screen.getByText("connection.form.title.edit")).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/connection.form.field.name/) as HTMLInputElement;
    expect(nameInput.value).toBe("existing");

    await userEvent.click(screen.getByRole("checkbox", { name: /save_without_testing/ })); // save without testing
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "renamed");
    await userEvent.click(screen.getByRole("button", { name: "connection.form.action.save" }));

    await waitFor(() => {
      expect(updateConnectionMock).toHaveBeenCalledWith(
        "conn-1",
        expect.objectContaining({ name: "renamed", password: { kind: "keep" } }),
      );
    });
    expect(storeState.upsertLocal).toHaveBeenCalled();
    expect(storeState.closeForm).toHaveBeenCalled();
  });

  it("password show/hide toggle swaps aria-label and input type", async () => {
    renderForm();
    const showButton = screen.getByRole("button", { name: "connection.form.password.show" });
    const passwordInput = screen.getByLabelText(/connection.form.field.password/);
    expect(passwordInput).toHaveAttribute("type", "password");

    await userEvent.click(showButton);

    expect(
      screen.getByRole("button", { name: "connection.form.password.hide" }),
    ).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute("type", "text");
  });

  it("dirty-discard confirmation: cancel after typing opens the discard sub-dialog", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/connection.form.field.name/), "x");
    // Find the cancel button (in dialog footer).
    const cancelButtons = screen.getAllByRole("button", {
      name: "connection.form.action.cancel",
    });
    // The footer cancel comes first by render order.
    await userEvent.click(cancelButtons[0]);

    // Discard confirmation opens — the test data-testid reveals it.
    await waitFor(() => {
      expect(screen.getByTestId("discard-confirm")).toBeInTheDocument();
    });
  });

  it("SSL warning appears for sslMode=disable on a non-localhost host", async () => {
    renderForm();
    const hostInput = screen.getByLabelText(/connection.form.field.host/);
    await userEvent.clear(hostInput);
    await userEvent.type(hostInput, "db.example.com");

    // Open the SSL combobox and pick "disable".
    const trigger = screen.getByRole("combobox", { name: "connection.form.field.ssl_mode" });
    await userEvent.click(trigger);
    const disableOption = await screen.findByRole("option", { name: /disable/ });
    await userEvent.click(disableOption);

    await waitFor(() => {
      expect(screen.getByText("connection.form.warning.ssl_disable_remote")).toBeInTheDocument();
    });
  });

  it("SSL warning is hidden when host is localhost", async () => {
    renderForm();
    // host already defaults to "localhost"; just pick disable.
    const trigger = screen.getByRole("combobox", { name: "connection.form.field.ssl_mode" });
    await userEvent.click(trigger);
    const disableOption = await screen.findByRole("option", { name: /disable/ });
    await userEvent.click(disableOption);

    expect(
      screen.queryByText("connection.form.warning.ssl_disable_remote"),
    ).not.toBeInTheDocument();
  });

  it("exclude-from-history checkbox is unchecked by default in create mode", () => {
    renderForm();
    const checkbox = screen.getByTestId("exclude-history-checkbox") as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
  });

  it("toggling exclude-from-history propagates true on submit (create)", async () => {
    createConnectionMock.mockResolvedValueOnce({ ...baseConnection, excludeFromHistory: true });
    renderForm();

    // 'Save without testing' to bypass test gate.
    await userEvent.click(screen.getByRole("checkbox", { name: /save_without_testing/ }));
    const exclude = screen.getByTestId("exclude-history-checkbox");
    await userEvent.click(exclude);
    expect(exclude).toBeChecked();

    await userEvent.type(screen.getByLabelText(/connection.form.field.name/), "x");
    await userEvent.type(screen.getByLabelText(/connection.form.field.username/), "u");
    await userEvent.click(screen.getByRole("button", { name: "connection.form.action.save" }));

    await waitFor(() => {
      expect(createConnectionMock).toHaveBeenCalledWith(
        expect.objectContaining({ excludeFromHistory: true }),
      );
    });
  });

  it("edit mode renders existing excludeFromHistory=true as a checked box", async () => {
    storeState.formMode = { type: "edit", id: "conn-1" };
    storeState.connections = [{ ...baseConnection, excludeFromHistory: true }];
    renderForm();

    const checkbox = screen.getByTestId("exclude-history-checkbox") as HTMLInputElement;
    await waitFor(() => {
      expect(checkbox).toBeChecked();
    });
  });

  // --- Task 18 — env dropdown + 3 safety checkboxes ---

  it("env dropdown defaults to local for new connection", () => {
    renderForm();
    const envTrigger = screen.getByRole("combobox", {
      name: "connection.form.field.environment",
    });
    // Trigger contains an EnvironmentBadge tinted for "local".
    expect(envTrigger.querySelector(".env-badge.local")).toBeInTheDocument();
  });

  it("selecting prod auto-checks confirm_destructive + slow_query_warning (read_only stays off)", async () => {
    renderForm();
    const readOnly = screen.getByTestId("read-only-checkbox") as HTMLInputElement;
    const slow = screen.getByTestId("slow-query-warning-checkbox") as HTMLInputElement;
    const confirmDestructive = screen.getByTestId(
      "confirm-destructive-checkbox",
    ) as HTMLInputElement;
    expect(readOnly).not.toBeChecked();
    expect(slow).not.toBeChecked();
    expect(confirmDestructive).not.toBeChecked();

    const envTrigger = screen.getByRole("combobox", {
      name: "connection.form.field.environment",
    });
    await userEvent.click(envTrigger);
    const prodOption = await screen.findByRole("option", { name: /env\.label\.prod/ });
    await userEvent.click(prodOption);

    // prod must NOT auto-enable read-only — read-only would block
    // DROP/TRUNCATE before the confirm-by-typing modal could fire. Instead,
    // prod auto-enables confirmDestructive so the typing modal triggers.
    await waitFor(() => {
      expect(confirmDestructive).toBeChecked();
    });
    expect(slow).toBeChecked();
    expect(readOnly).not.toBeChecked();
  });

  it("confirm-destructive checkbox toggles independently after prod selection", async () => {
    renderForm();
    const envTrigger = screen.getByRole("combobox", {
      name: "connection.form.field.environment",
    });
    await userEvent.click(envTrigger);
    const prodOption = await screen.findByRole("option", { name: /env\.label\.prod/ });
    await userEvent.click(prodOption);

    const confirmDestructive = screen.getByTestId(
      "confirm-destructive-checkbox",
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(confirmDestructive).toBeChecked();
    });

    await userEvent.click(confirmDestructive);
    expect(confirmDestructive).not.toBeChecked();
  });

  it("create payload includes env + 3 booleans", async () => {
    createConnectionMock.mockResolvedValueOnce({
      ...baseConnection,
      environment: "stage",
      slowQueryWarning: true,
    });
    renderForm();

    // Save without testing to bypass the test gate.
    await userEvent.click(screen.getByRole("checkbox", { name: /save_without_testing/ }));

    // Pick env=stage from the dropdown.
    const envTrigger = screen.getByRole("combobox", {
      name: "connection.form.field.environment",
    });
    await userEvent.click(envTrigger);
    const stageOption = await screen.findByRole("option", { name: /env\.label\.stage/ });
    await userEvent.click(stageOption);

    // Tick slowQueryWarning checkbox.
    await userEvent.click(screen.getByTestId("slow-query-warning-checkbox"));

    await userEvent.type(screen.getByLabelText(/connection.form.field.name/), "x");
    await userEvent.type(screen.getByLabelText(/connection.form.field.username/), "u");
    await userEvent.click(screen.getByRole("button", { name: "connection.form.action.save" }));

    await waitFor(() => {
      expect(createConnectionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: "stage",
          readOnly: false,
          slowQueryWarning: true,
          confirmDestructive: false,
        }),
      );
    });
  });

  it("confirm-destructive checkbox is independent of read-only", async () => {
    renderForm();
    const readOnly = screen.getByTestId("read-only-checkbox") as HTMLInputElement;
    const confirmDestructive = screen.getByTestId(
      "confirm-destructive-checkbox",
    ) as HTMLInputElement;
    expect(readOnly).not.toBeChecked();
    expect(confirmDestructive).not.toBeChecked();

    await userEvent.click(confirmDestructive);
    expect(confirmDestructive).toBeChecked();
    // Toggling confirmDestructive must not flip readOnly.
    expect(readOnly).not.toBeChecked();
  });

  // --- Issue #15 — Save enables on non-connectivity setting changes ---

  it("edit mode: changing environment alone enables Save without a test", async () => {
    storeState.formMode = { type: "edit", id: "conn-1" };
    storeState.connections = [baseConnection];
    renderForm();

    await waitFor(() => {
      expect(screen.getByText("connection.form.title.edit")).toBeInTheDocument();
    });
    const saveButton = screen.getByRole("button", { name: "connection.form.action.save" });
    // Untouched edit form: Save starts disabled (no test, no checkbox, not dirty).
    expect(saveButton).toBeDisabled();

    const envTrigger = screen.getByRole("combobox", {
      name: "connection.form.field.environment",
    });
    await userEvent.click(envTrigger);
    const stageOption = await screen.findByRole("option", { name: /env\.label\.stage/ });
    await userEvent.click(stageOption);

    // environment is a non-connectivity setting → a dirty edit to it alone
    // enables Save with no connection test required (this is issue #15).
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
  });

  it("edit mode: changing a connectivity field (host) keeps Save gated", async () => {
    storeState.formMode = { type: "edit", id: "conn-1" };
    storeState.connections = [baseConnection];
    renderForm();

    const hostInput = screen.getByLabelText(/connection.form.field.host/);
    await waitFor(() => {
      expect((hostInput as HTMLInputElement).value).toBe("db.example.com");
    });
    const saveButton = screen.getByRole("button", { name: "connection.form.action.save" });

    await userEvent.type(hostInput, "x"); // host is connectivity-affecting → dirty
    // A connectivity edit must NOT enable Save on its own — the last test no
    // longer reflects what we'd persist.
    expect(saveButton).toBeDisabled();

    // The explicit "save without testing" opt-in still works.
    await userEvent.click(screen.getByRole("checkbox", { name: /save_without_testing/ }));
    expect(saveButton).not.toBeDisabled();
  });

  it("edit mode: a successful test enables Save with no field edits (regression guard)", async () => {
    // Edit mode + blank password routes through testConnectionForEdit (the
    // backend fills the password from the keychain), not testConnection.
    testConnectionForEditMock.mockResolvedValueOnce({
      ok: true,
      durationMs: 42,
      error: null,
      serverVersion: "PostgreSQL 17.2",
    });
    storeState.formMode = { type: "edit", id: "conn-1" };
    storeState.connections = [baseConnection];
    renderForm();

    await waitFor(() => {
      expect(screen.getByText("connection.form.title.edit")).toBeInTheDocument();
    });
    const saveButton = screen.getByRole("button", { name: "connection.form.action.save" });
    expect(saveButton).toBeDisabled();

    // No edits at all — just re-test. Save must enable on test success even
    // though the form is not dirty; guards against gating Save behind isDirty.
    await userEvent.click(screen.getByRole("button", { name: "connection.form.action.test" }));
    await waitFor(() => {
      expect(screen.getByTestId("form-test-success")).toBeInTheDocument();
    });
    expect(saveButton).not.toBeDisabled();
  });
});
