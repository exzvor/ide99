import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import i18n from "../../../i18n";
import type { useConnections } from "../../connections/store";
import { ActionPreviewModal } from "./ActionPreviewModal";
import { useHealthActions } from "./store";

const conn = {
  id: "c1",
  name: "test",
  environment: "local" as const,
  confirmDestructive: false,
} as ReturnType<typeof useConnections.getState>["connections"][number];

const prodConn = {
  ...(conn as object),
  environment: "prod" as const,
} as typeof conn;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ActionPreviewModal", () => {
  afterEach(() => useHealthActions.setState({ phase: { kind: "idle" } }));

  it("renders preview SQL + impact for vacuum", () => {
    useHealthActions.setState({
      phase: {
        kind: "preview",
        target: { kind: "vacuum", schema: "public", table: "users" },
        conn,
      },
    });
    render(<ActionPreviewModal />);
    expect(screen.getByText('VACUUM "public"."users"')).toBeInTheDocument();
  });

  it("requires type-the-target on prod and disables Run until match", () => {
    useHealthActions.setState({
      phase: {
        kind: "preview",
        target: { kind: "vacuum", schema: "public", table: "users" },
        conn: prodConn,
      },
    });
    render(<ActionPreviewModal />);
    const btn = screen.getByTestId("action-preview-run") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/confirm/i), {
      target: { value: "users" },
    });
    expect(btn.disabled).toBe(false);
  });

  it("Cancel resets phase", () => {
    useHealthActions.setState({
      phase: {
        kind: "preview",
        target: { kind: "analyze", schema: "public", table: "users" },
        conn,
      },
    });
    render(<ActionPreviewModal />);
    fireEvent.click(screen.getByText(/cancel/i));
    expect(useHealthActions.getState().phase.kind).toBe("idle");
  });

  it("renders nothing when phase != preview", () => {
    const { container } = render(<ActionPreviewModal />);
    expect(container.firstChild).toBeNull();
  });
});
