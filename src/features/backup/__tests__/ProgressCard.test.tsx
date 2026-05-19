/**
 * — ProgressCard renders the four terminal/transient states.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return Object.entries(vars).reduce<string>(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v)),
        key,
      );
    },
  }),
}));

import { ProgressCard } from "../ProgressCard";
import type { JobState } from "../store";

afterEach(() => vi.clearAllMocks());

const job = (over: Partial<JobState> = {}): JobState => ({
  jobId: "j1",
  status: "idle",
  phase: null,
  detail: null,
  percent: null,
  exitCode: null,
  stderrTail: "",
  startedAt: null,
  finishedAt: null,
  outputPath: null,
  ...over,
});

describe("ProgressCard", () => {
  it("renders nothing while job is undefined or idle", () => {
    const { rerender, container } = render(<ProgressCard job={undefined} onCancel={() => {}} />);
    expect(container.firstChild).toBeNull();
    rerender(<ProgressCard job={job({ status: "idle" })} onCancel={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("running state shows phase + cancel button", async () => {
    const onCancel = vi.fn();
    render(
      <ProgressCard
        job={job({ status: "running", phase: "dumping", detail: "public.users" })}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByTestId("backup-progress-card")).toHaveTextContent(/dumping/);
    expect(screen.getByTestId("backup-progress-card")).toHaveTextContent(/public\.users/);
    await userEvent.setup().click(screen.getByTestId("backup-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("running state with percent renders a progressbar with aria-valuenow", () => {
    render(<ProgressCard job={job({ status: "running", percent: 42 })} onCancel={() => {}} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
  });

  it("done state renders success banner referring to the output path", () => {
    render(
      <ProgressCard job={job({ status: "done", outputPath: "/tmp/x.dump" })} onCancel={() => {}} />,
    );
    const card = screen.getByTestId("backup-progress-card");
    expect(card).toHaveTextContent(/run\.success/);
    // The output_path key receives a `{path}` interpolation which the t-mock
    // strips in tests. We just verify the dedicated div is present.
    expect(card).toHaveTextContent(/run\.output_path/);
  });

  it("failed state renders alert with stderr tail", () => {
    render(
      <ProgressCard
        job={job({ status: "failed", stderrTail: "pg_dump: connection refused" })}
        onCancel={() => {}}
      />,
    );
    const card = screen.getByTestId("backup-progress-card");
    expect(card).toHaveAttribute("role", "alert");
    expect(card).toHaveTextContent(/connection refused/);
  });

  it("cancelled state shows the cancellation message", () => {
    render(<ProgressCard job={job({ status: "cancelled" })} onCancel={() => {}} />);
    expect(screen.getByTestId("backup-progress-card")).toHaveTextContent(/cancelled/);
  });
});
