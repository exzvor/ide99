// — : smoke tests for the per-table pgvector panel.
//
// We mock the three child surfaces so we can detect which dialog the panel
// opens for each button. Each mock renders a div carrying its `open` prop as
// a `data-open` attribute so the test can read it back.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../KnnBrowseDialog", () => ({
  KnnBrowseDialog: ({ open }: { open: boolean }) => (
    <div data-testid="knn-mock" data-open={open ? "true" : "false"} />
  ),
}));

vi.mock("../VectorProjectionView", () => ({
  VectorProjectionView: () => <div data-testid="projection-mock" data-open="true" />,
}));

vi.mock("../HybridSearchWizard", () => ({
  HybridSearchWizard: ({ open }: { open: boolean }) => (
    <div data-testid="hybrid-mock" data-open={open ? "true" : "false"} />
  ),
}));

import { PgvectorTablePanel } from "../PgvectorTablePanel";

const baseProps = {
  connId: "conn-1",
  qualifiedTable: "public.items",
  pk: "id" as string | null,
  vectorColumns: [{ name: "embedding", type: "vector", dim: 384 }],
  textColumns: ["title_ts"],
  rowCount: 1000,
};

describe("PgvectorTablePanel", () => {
  it("enables all three buttons when prerequisites are met and opens each on click", async () => {
    render(<PgvectorTablePanel {...baseProps} />);

    const knn = screen.getByTestId("panel-knn") as HTMLButtonElement;
    const proj = screen.getByTestId("panel-projection") as HTMLButtonElement;
    const hybrid = screen.getByTestId("panel-hybrid") as HTMLButtonElement;
    expect(knn).not.toBeDisabled();
    expect(proj).not.toBeDisabled();
    expect(hybrid).not.toBeDisabled();

    // kNN dialog starts closed (data-open="false") then opens on click.
    expect(screen.getByTestId("knn-mock").getAttribute("data-open")).toBe("false");
    await userEvent.click(knn);
    expect(screen.getByTestId("knn-mock").getAttribute("data-open")).toBe("true");

    // Projection view is rendered conditionally on click.
    expect(screen.queryByTestId("projection-mock")).not.toBeInTheDocument();
    await userEvent.click(proj);
    expect(screen.getByTestId("projection-mock")).toBeInTheDocument();

    // Hybrid wizard starts closed, opens on click.
    expect(screen.getByTestId("hybrid-mock").getAttribute("data-open")).toBe("false");
    await userEvent.click(hybrid);
    expect(screen.getByTestId("hybrid-mock").getAttribute("data-open")).toBe("true");
  });

  it("disables projection + hybrid when pk is null but keeps kNN enabled", () => {
    render(<PgvectorTablePanel {...baseProps} pk={null} />);
    expect(screen.getByTestId("panel-knn")).not.toBeDisabled();
    expect(screen.getByTestId("panel-projection")).toBeDisabled();
    expect(screen.getByTestId("panel-hybrid")).toBeDisabled();
  });

  it("disables hybrid when there are no text columns", () => {
    render(<PgvectorTablePanel {...baseProps} textColumns={[]} />);
    expect(screen.getByTestId("panel-knn")).not.toBeDisabled();
    expect(screen.getByTestId("panel-projection")).not.toBeDisabled();
    expect(screen.getByTestId("panel-hybrid")).toBeDisabled();
  });

  it("returns null when there are no vector columns", () => {
    const { container } = render(<PgvectorTablePanel {...baseProps} vectorColumns={[]} />);
    expect(screen.queryByTestId("pgvector-table-panel")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });
});
