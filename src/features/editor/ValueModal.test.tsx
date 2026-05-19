import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ValueModal } from "./ValueModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

describe("ValueModal", () => {
  test("renders nothing when open=false", () => {
    const { container } = render(
      <ValueModal open={false} onClose={() => {}} value="x" language="text" />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test("renders raw text for language=text", () => {
    render(<ValueModal open={true} onClose={() => {}} value="hello world" language="text" />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  test("pretty-prints valid JSON for language=json", () => {
    render(<ValueModal open={true} onClose={() => {}} value='{"a":1,"b":[2,3]}' language="json" />);
    // Pretty-printed across multiple lines means '"a": 1' substring should appear with the spacing.
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });

  test("falls back to raw value if JSON parse fails", () => {
    render(<ValueModal open={true} onClose={() => {}} value="not-json" language="json" />);
    expect(screen.getByText("not-json")).toBeInTheDocument();
  });

  // — i18n keys drive the dialog title (no hardcoded English).
  test("uses i18n key for JSON dialog title", () => {
    render(<ValueModal open={true} onClose={() => {}} value="{}" language="json" />);
    expect(screen.getByText("editor.value_modal.title_json")).toBeInTheDocument();
  });

  test("uses i18n key for text dialog title", () => {
    render(<ValueModal open={true} onClose={() => {}} value="x" language="text" />);
    expect(screen.getByText("editor.value_modal.title_text")).toBeInTheDocument();
  });
});
