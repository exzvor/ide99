// — : smoke tests for the VectorIndexWizard modal.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VectorIndexWizard } from "../VectorIndexWizard";

describe("VectorIndexWizard", () => {
  it("HNSW path: small rowCount → applies recommended HNSW defaults", async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <VectorIndexWizard
        open={true}
        rowCount={500}
        dim={768}
        onCancel={onCancel}
        onApply={onApply}
      />,
    );

    // Rationale reflects the small-table category.
    const rationale = screen.getByTestId("wizard-rationale");
    expect(rationale.textContent).toMatch(/small table/i);

    await userEvent.click(screen.getByTestId("wizard-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      method: "hnsw",
      withOptions: { m: 16, ef_construction: 64 },
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("IVFFlat path: large rowCount → applies recommended IVFFlat defaults", async () => {
    const onApply = vi.fn();
    render(
      <VectorIndexWizard
        open={true}
        rowCount={4_000_000}
        dim={768}
        onCancel={() => {}}
        onApply={onApply}
      />,
    );

    await userEvent.click(screen.getByTestId("wizard-apply"));
    expect(onApply).toHaveBeenCalledWith({
      method: "ivfflat",
      withOptions: { lists: 2000 },
    });
  });

  it("manual override: user toggles ivfflat radio + edits lists, then applies", async () => {
    const onApply = vi.fn();
    render(
      <VectorIndexWizard
        open={true}
        rowCount={500}
        dim={768}
        onCancel={() => {}}
        onApply={onApply}
      />,
    );

    // Toggle to IVFFlat.
    await userEvent.click(screen.getByTestId("wizard-method-ivfflat"));

    // Replace the lists value with 256.
    const listsInput = screen.getByTestId("wizard-param-lists") as HTMLInputElement;
    await userEvent.clear(listsInput);
    await userEvent.type(listsInput, "256");

    await userEvent.click(screen.getByTestId("wizard-apply"));
    expect(onApply).toHaveBeenCalledWith({
      method: "ivfflat",
      withOptions: { lists: 256 },
    });
  });

  it("clicking cancel calls onCancel", async () => {
    const onCancel = vi.fn();
    render(
      <VectorIndexWizard
        open={true}
        rowCount={500}
        dim={768}
        onCancel={onCancel}
        onApply={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId("wizard-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <VectorIndexWizard
        open={false}
        rowCount={500}
        dim={768}
        onCancel={() => {}}
        onApply={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("vector-index-wizard")).not.toBeInTheDocument();
  });
});
