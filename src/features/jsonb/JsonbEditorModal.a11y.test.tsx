import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { JsonbEditorModal } from "./JsonbEditorModal";
import { useJsonbEditor } from "./state/store";

expect.extend(toHaveNoViolations);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return `${key} ${Object.values(vars).map(String).join(" ")}`;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    jsonbResolveRowKey: vi.fn().mockResolvedValue({
      kind: "pk",
      schema: "public",
      table: "events",
      columns: [{ name: "id", value: "1", typeName: "int4" }],
    }),
    jsonbSave: vi.fn(),
  };
});

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

describe("JsonbEditorModal accessibility", () => {
  it("has 0 axe violations when open in tree mode (pk rowKey)", async () => {
    useJsonbEditor.setState({
      open: true,
      args: { tabId: "t1", rowIdx: 0, srcColIdx: 1 },
      original: '{"a":1}',
      draft: '{"a":1}',
      draftParsed: { a: 1 },
      draftParseError: null,
      diff: { ops: [], fullReplace: false },
      mode: "tree",
      rowKey: {
        kind: "pk",
        schema: "public",
        table: "events",
        columns: [{ name: "id", value: "1", typeName: "int4" }],
      },
      envIsProd: false,
      fqTableName: "public.events",
      status: { kind: "idle" },
    });
    const { container } = render(<JsonbEditorModal />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
