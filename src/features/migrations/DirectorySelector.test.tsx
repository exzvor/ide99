/**
 * — 
 *
 * DirectorySelector wraps the OS folder-picker (`@tauri-apps/plugin-dialog`)
 * and the two persistence commands. Two tests cover the happy paths:
 *
 * - Change… opens the dialog and persists via `migrations_set_dir`.
 * - Clear invokes `migrations_clear_dir` and updates local state.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const openDialogMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
}));

const FAKE_DICT: Record<string, string> = {
  "migrations.panel.directory": "Directory",
  "migrations.panel.directoryNotSet": "Not set",
  "migrations.panel.change": "Change…",
  "migrations.panel.clear": "Clear",
  "migrations.selector.openDialog": "Pick migrations directory",
  "migrations.selector.title": "Migrations directory",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => FAKE_DICT[key] ?? key,
  }),
}));

import { DirectorySelector } from "./DirectorySelector";

beforeEach(() => {
  invokeMock.mockReset();
  openDialogMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DirectorySelector", () => {
  it("Change… opens tauri folder dialog and persists via migrations_set_dir", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/repo/db/migrations");
    const onChanged = vi.fn();
    render(<DirectorySelector connectionId="c1" currentDir={null} onChanged={onChanged} />);
    await user.click(screen.getByTestId("directory-selector-change"));
    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalledWith({
        directory: true,
        multiple: false,
      });
      expect(invokeMock).toHaveBeenCalledWith("migrations_set_dir", {
        connId: "c1",
        dir: "/repo/db/migrations",
      });
      expect(onChanged).toHaveBeenCalledWith("/repo/db/migrations");
    });
  });

  it("Clear invokes migrations_clear_dir", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(      <DirectorySelector
        connectionId="c1"
        currentDir="/repo/db/migrations"
        onChanged={onChanged}
      />,
);
    await user.click(screen.getByTestId("directory-selector-clear"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("migrations_clear_dir", { connId: "c1" });
      expect(onChanged).toHaveBeenCalledWith(null);
    });
  });
});
