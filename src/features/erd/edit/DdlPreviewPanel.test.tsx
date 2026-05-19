import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import type { ApplyError, ErdSchemaGraph } from "../../../lib/tauri";
import { DdlPreviewPanel } from "./DdlPreviewPanel";
import { useEditStore } from "./store";
import type { DdlGenResult, ValidationIssue } from "./types";

// ---- mocks ----------------------------------------------------------------

vi.mock("@monaco-editor/react", () => ({
  Editor: (props: {
    value?: string;
    onChange?: (v: string | undefined) => void;
  }) => (    <textarea
      data-testid="ddl-monaco-mock"
      value={props.value ?? ""}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
),
}));

vi.mock("../../../lib/parser", () => ({
  parseDdl: vi.fn(async () => ({ ok: true as const, value: { changes: [], warnings: [] } })),
}));

const TAB = "tab-erd";
const emptyBase: ErdSchemaGraph = { tables: [], foreignKeys: [], fetchedInMs: 0 };

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  useEditStore.getState().reset();
});

function harness(args: Partial<React.ComponentProps<typeof DdlPreviewPanel>>) {
  return render(    <I18nextProvider i18n={i18n}>
      <DdlPreviewPanel
        ddl={{ sql: "", statements: [] }}
        issues={[]}
        applyError={null}
        tabId={TAB}
        baseGraph={emptyBase}
        {...args}
      />
    </I18nextProvider>,
);
}

describe("DdlPreviewPanel", () => {
  it("Monaco host mounts even when DDL is empty", () => {
    harness({});
    expect(screen.getByTestId("ddl-preview-monaco-host")).toBeInTheDocument();
  });

  it("renders generated DDL via Monaco's value prop", () => {
    const ddl: DdlGenResult = {
      sql: 'CREATE TABLE "public"."events" ();',
      statements: [{ sql: 'CREATE TABLE "public"."events" ();', opIds: ["t1"], warnings: [] }],
    };
    harness({ ddl });
    expect((screen.getByTestId("ddl-monaco-mock") as HTMLTextAreaElement).value).toContain(      "CREATE TABLE",
);
  });

  it("statement_count label reflects N", () => {
    const ddl: DdlGenResult = {
      sql: "A;\n\nB;",
      statements: [
        { sql: "A;", opIds: [], warnings: [] },
        { sql: "B;", opIds: [], warnings: [] },
      ],
    };
    harness({ ddl });
    expect(screen.getByTestId("ddl-preview-count")).toHaveTextContent("2");
  });

  it("warning banner visible when any warning issue", () => {
    const issues: ValidationIssue[] = [
      {
        kind: "fk-type-mismatch",
        opId: "x",
        sourceType: "text",
        targetType: "bigint",
        severity: "warning",
      },
    ];
    harness({ issues });
    expect(screen.getByTestId("ddl-preview-warnings")).toBeInTheDocument();
  });

  it("applyError shows red banner with PG message + statement index", () => {
    const applyError: ApplyError = {
      failingStatementIndex: 1,
      failingSql: 'ALTER TABLE "public"."x" ...;',
      pgErrorCode: "42P07",
      pgMessage: "duplicate_table",
      pgHint: null,
    };
    harness({ applyError });
    const banner = screen.getByTestId("ddl-preview-error");
    expect(banner).toHaveTextContent("42P07");
    expect(banner).toHaveTextContent("duplicate_table");
  });

  it("AST parse-error banner renders when store has astParseError", () => {
    useEditStore.getState().setAstParseError(TAB, {
      message: 'syntax error at or near "TABL"',
      line: 3,
      column: 12,
    });
    harness({});
    const banner = screen.getByTestId("ddl-preview-parse-error");
    expect(banner).toHaveTextContent("3");
    expect(banner).toHaveTextContent("syntax error");
  });

  it("AST warnings list rendered when store has astWarnings", () => {
    useEditStore
      .getState()
      .replaceOpsFromAst(        TAB,
        [],
        [{ message: "Index DDL not supported", sqlSnippet: "CREATE INDEX foo ON bar (x)" }],
        "CREATE INDEX foo ON bar (x);",
);
    harness({});
    expect(screen.getByTestId("ddl-preview-ast-warnings")).toBeInTheDocument();
    expect(screen.getByTestId("ddl-preview-ast-warnings-list")).toHaveTextContent(      "Index DDL not supported",
);
  });
});
