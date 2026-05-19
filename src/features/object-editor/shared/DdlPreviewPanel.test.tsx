import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, test, vi } from "vitest";
import i18n from "../../../i18n";
import type { DdlResult } from "../ddl/types";
import { DdlPreviewPanel } from "./DdlPreviewPanel";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function makeResult(over: Partial<DdlResult> = {}): DdlResult {
  return {
    sql: "",
    warnings: [],
    errors: [],
    ...over,
  };
}

function H(props: Partial<React.ComponentProps<typeof DdlPreviewPanel>> = {}) {
  const defaults: React.ComponentProps<typeof DdlPreviewPanel> = {
    result: makeResult({ sql: "CREATE TABLE foo (id BIGINT);" }),
    onApply: vi.fn(),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <DdlPreviewPanel {...defaults} {...props} />
    </I18nextProvider>,
  );
}

describe("DdlPreviewPanel", () => {
  test("renders sql in <pre>", () => {
    H({ result: makeResult({ sql: "CREATE TABLE foo (id BIGINT);" }) });
    const pre = screen.getByTestId("ddl-preview-sql");
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveTextContent("CREATE TABLE foo (id BIGINT);");
  });

  test("empty sql shows the no-changes placeholder", () => {
    H({ result: makeResult({ sql: "   " }) });
    const pre = screen.getByTestId("ddl-preview-sql");
    expect(pre).toHaveTextContent("-- No changes");
  });

  test("errors disable Apply (and surface aria-disabled)", () => {
    const onApply = vi.fn();
    H({
      result: makeResult({
        sql: "CREATE TABLE foo (id BIGINT);",
        errors: [{ code: "E1", message: "duplicate column" }],
      }),
      onApply,
    });
    const apply = screen.getByTestId("ddl-preview-apply");
    expect(apply).toBeDisabled();
    expect(apply).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
    // Errors render visibly.
    expect(screen.getByTestId("ddl-preview-errors")).toHaveTextContent("duplicate column");
  });

  test("warnings render in the warnings list (yellow style)", () => {
    H({
      result: makeResult({
        sql: "CREATE TABLE foo (id BIGINT);",
        warnings: [{ code: "W1", message: "Heads up: this is destructive" }],
      }),
    });
    const list = screen.getByTestId("ddl-preview-warnings");
    expect(list).toHaveTextContent("Heads up: this is destructive");
    expect(list.getAttribute("style") ?? "").toMatch(/--warn|d4a017/);
  });

  test("clicking Copy invokes navigator.clipboard.writeText with the sql", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    H({ result: makeResult({ sql: "CREATE TABLE foo (id BIGINT);" }) });
    fireEvent.click(screen.getByTestId("ddl-preview-copy"));
    expect(writeText).toHaveBeenCalledWith("CREATE TABLE foo (id BIGINT);");
  });
});
