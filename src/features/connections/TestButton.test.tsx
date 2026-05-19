import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}::${JSON.stringify(opts)}` : key,
  }),
}));

const testConnectionMock = vi.fn();
const testSavedConnectionMock = vi.fn();
vi.mock("../../lib/tauri", () => ({
  testConnection: (input: unknown) => testConnectionMock(input),
  testSavedConnection: (id: string) => testSavedConnectionMock(id),
}));

import { TestButton } from "./TestButton";

const inputFixture = {
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "u",
  password: "p",
  sslMode: "prefer" as const,
};

describe("TestButton", () => {
  beforeEach(() => {
    testConnectionMock.mockReset();
    testSavedConnectionMock.mockReset();
  });

  it("input variant: renders an accessible button with the test label", () => {
    render(<TestButton variant="input" getInput={() => inputFixture} />);
    expect(screen.getByRole("button", { name: /connection.form.action.test/ })).toBeInTheDocument();
  });

  it("input variant: success path shows a success badge and calls onResult", async () => {
    testConnectionMock.mockResolvedValueOnce({
      ok: true,
      durationMs: 87,
      error: null,
      serverVersion: "PostgreSQL 17.2",
    });
    const onResult = vi.fn();

    const user = userEvent.setup();
    render(<TestButton variant="input" getInput={() => inputFixture} onResult={onResult} />);
    await user.click(screen.getByRole("button"));

    expect(testConnectionMock).toHaveBeenCalledWith(inputFixture);
    expect(await screen.findByTestId("test-success-badge")).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(      expect.objectContaining({ ok: true, serverVersion: "PostgreSQL 17.2" }),
);
  });

  it("input variant: failure path shows a failure badge and calls onResult", async () => {
    testConnectionMock.mockResolvedValueOnce({
      ok: false,
      durationMs: 12,
      error: "connection refused",
      serverVersion: null,
    });
    const onResult = vi.fn();

    const user = userEvent.setup();
    render(<TestButton variant="input" getInput={() => inputFixture} onResult={onResult} />);
    await user.click(screen.getByRole("button"));

    expect(await screen.findByTestId("test-failure-badge")).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("input variant: rejected invoke calls onError and surfaces a failure badge", async () => {
    testConnectionMock.mockRejectedValueOnce(new Error("boom"));
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<TestButton variant="input" getInput={() => inputFixture} onError={onError} />);
    await user.click(screen.getByRole("button"));

    expect(await screen.findByTestId("test-failure-badge")).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
  });

  it("saved variant: invokes testSavedConnection with the connection id", async () => {
    testSavedConnectionMock.mockResolvedValueOnce({
      ok: true,
      durationMs: 50,
      error: null,
      serverVersion: null,
    });
    const user = userEvent.setup();
    render(<TestButton variant="saved" connectionId="abc-123" />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => expect(testSavedConnectionMock).toHaveBeenCalledWith("abc-123"));
    expect(await screen.findByTestId("test-success-badge")).toBeInTheDocument();
  });

  it("respects disabled prop", () => {
    render(<TestButton variant="input" getInput={() => inputFixture} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
