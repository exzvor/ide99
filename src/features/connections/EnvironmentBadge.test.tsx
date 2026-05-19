import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EnvironmentBadge } from "./EnvironmentBadge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("EnvironmentBadge", () => {
  it("renders with env class", () => {
    const { container } = render(<EnvironmentBadge environment="prod" />);
    expect(container.querySelector(".env-badge.prod")).toBeInTheDocument();
  });

  it("has aria-label per env", () => {
    render(<EnvironmentBadge environment="dev" />);
    expect(screen.getByRole("img", { name: /env\.label\.dev/i })).toBeInTheDocument();
  });

  it.each(["local", "dev", "stage", "prod"] as const)("renders all 4 envs (%s)", (env) => {
    const { container } = render(<EnvironmentBadge environment={env} />);
    expect(container.querySelector(`.env-badge.${env}`)).toBeInTheDocument();
  });
});
