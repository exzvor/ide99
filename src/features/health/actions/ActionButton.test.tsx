import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import i18n from "../../../i18n";
import { useConnections } from "../../connections/store";
import { ActionButton } from "./ActionButton";
import { setEasyModeForTesting } from "./easyMode";
import { useHealthActions } from "./store";

const conn = {
  id: "c1",
  name: "test",
  environment: "local" as const,
} as ReturnType<typeof useConnections.getState>["connections"][number];

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ActionButton", () => {
  afterEach(() => {
    setEasyModeForTesting(false);
    useHealthActions.setState({ phase: { kind: "idle" } });
    useConnections.setState({ connections: [] });
  });

  it("renders an icon button when easy mode is off and connection exists", () => {
    useConnections.setState({ connections: [conn as never] });
    render(
      <ActionButton
        kind="vacuum"
        target={{ kind: "vacuum", schema: "public", table: "users" }}
        connId="c1"
      />,
    );
    expect(screen.getByTestId("health-action-vacuum-public.users")).toBeInTheDocument();
  });

  it("renders nothing in Easy mode", () => {
    useConnections.setState({ connections: [conn as never] });
    setEasyModeForTesting(true);
    const { container } = render(
      <ActionButton
        kind="vacuum"
        target={{ kind: "vacuum", schema: "public", table: "users" }}
        connId="c1"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("opens the preview modal on click", () => {
    useConnections.setState({ connections: [conn as never] });
    render(
      <ActionButton
        kind="vacuum"
        target={{ kind: "vacuum", schema: "public", table: "users" }}
        connId="c1"
      />,
    );
    fireEvent.click(screen.getByTestId("health-action-vacuum-public.users"));
    expect(useHealthActions.getState().phase.kind).toBe("preview");
  });
});
