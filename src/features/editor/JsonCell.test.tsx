import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { JsonCell } from "./JsonCell";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

describe("JsonCell", () => {
  test("renders single-line collapsed value", () => {
    const value = '{"a":1,"b":[2,3]}';
    render(<JsonCell value={value} />);
    expect(screen.getByText(value)).toBeInTheDocument();
  });

  test("does not open any modal on click — made the cell render-only", async () => {
    const user = userEvent.setup();
    render(<JsonCell value='{"a":1}' />);
    await user.click(screen.getByText('{"a":1}'));
    expect(screen.queryByTestId("value-modal-pre")).toBeNull();
  });

  test("does not open any modal on double-click — handling moved to ResultGrid", async () => {
    const user = userEvent.setup();
    render(<JsonCell value='{"a":1}' />);
    await user.dblClick(screen.getByText('{"a":1}'));
    expect(screen.queryByTestId("value-modal-pre")).toBeNull();
  });
});
