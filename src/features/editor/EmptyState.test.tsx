import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const { translation } = vi.hoisted(() => {
  const t = (key: string) => key;
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

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  test("renders title + body copy with editor.empty.* keys", () => {
    render(<EmptyState />);
    expect(screen.getByTestId("editor-empty")).toBeInTheDocument();
    expect(screen.getByText("editor.empty.title")).toBeInTheDocument();
    expect(screen.getByText("editor.empty.body")).toBeInTheDocument();
  });
});
