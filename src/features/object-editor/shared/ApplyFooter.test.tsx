import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import i18n from "../../../i18n";
import type { ApplyError, ApplyResult } from "../../../lib/tauri";
import { ApplyFooter } from "./ApplyFooter";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaApplyDdl: vi.fn(),
  };
});

const editorCloseTab = vi.fn().mockResolvedValue(true);
vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: vi.fn(() => ({
      closeTab: editorCloseTab,
    })),
  },
}));

vi.mock("../../erd/store", () => ({
  useErdStore: {
    getState: () => ({
      invalidate: vi.fn(),
    }),
  },
}));

vi.mock("../../schema/store", () => ({
  useSchema: {
    getState: () => ({
      refreshAll: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../connections/store", () => ({
  useConnections: (selector: (s: unknown) => unknown) =>
    selector({ connections: [{ id: "conn-1", name: "test-db" }] }),
}));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => vi.clearAllMocks());

function H(props: Partial<React.ComponentProps<typeof ApplyFooter>> = {}) {
  const defaults: React.ComponentProps<typeof ApplyFooter> = {
    tabId: "tab-1",
    connId: "conn-1",
    ddl: "CREATE TABLE foo (id BIGINT);",
    isDirty: true,
    errors: [],
    onSuccess: vi.fn(),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <ApplyFooter {...defaults} {...props} />
    </I18nextProvider>,
  );
}

describe("ApplyFooter", () => {
  test("Apply opens ApplyConfirmModal", () => {
    H();
    fireEvent.click(screen.getByTestId("apply-footer-apply"));
    expect(screen.getByTestId("apply-confirm-modal")).toBeTruthy();
  });

  test("Cancel button delegates to onCancel prop (not closeTab)", () => {
    const onCancel = vi.fn();
    H({ onCancel });
    fireEvent.click(screen.getByTestId("apply-footer-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(editorCloseTab).not.toHaveBeenCalled();
  });

  test("Apply success path triggers onSuccess callback", async () => {
    const { schemaApplyDdl } = await import("../../../lib/tauri");
    const result: ApplyResult = { statementsExecuted: 1, durationMs: 5 };
    vi.mocked(schemaApplyDdl).mockResolvedValueOnce(result);
    const onSuccess = vi.fn();
    H({ onSuccess });
    fireEvent.click(screen.getByTestId("apply-footer-apply"));
    fireEvent.click(screen.getByTestId("apply-confirm-ok"));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    expect(vi.mocked(schemaApplyDdl)).toHaveBeenCalledWith(
      "conn-1",
      "CREATE TABLE foo (id BIGINT);",
    );
  });

  test("Apply error shows red banner and does not fire onSuccess", async () => {
    const { schemaApplyDdl } = await import("../../../lib/tauri");
    const err: ApplyError = {
      failingStatementIndex: 0,
      failingSql: "CREATE TABLE foo (id BIGINT);",
      pgErrorCode: "42P07",
      pgMessage: 'relation "foo" already exists',
      pgHint: null,
    };
    vi.mocked(schemaApplyDdl).mockRejectedValueOnce(err);
    const onSuccess = vi.fn();
    H({ onSuccess });
    fireEvent.click(screen.getByTestId("apply-footer-apply"));
    fireEvent.click(screen.getByTestId("apply-confirm-ok"));
    await waitFor(() => {
      expect(screen.getByTestId("apply-footer-error")).toHaveTextContent("42P07");
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("Apply with errors → button disabled", () => {
    const onSuccess = vi.fn();
    H({
      errors: [{ code: "E1", message: "duplicate column" }],
      onSuccess,
    });
    const apply = screen.getByTestId("apply-footer-apply");
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(screen.queryByTestId("apply-confirm-modal")).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
