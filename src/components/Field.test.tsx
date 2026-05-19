import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";

function RhfHarness({
  defaultValues,
  errorOverride,
}: {
  defaultValues?: { name?: string };
  errorOverride?: string;
}) {
  const methods = useForm<{ name: string }>({ defaultValues });
  return (    <FormProvider {...methods}>
      <form>
        <Field
          label="Name"
          name="name"
          required
          inputProps={{ placeholder: "My PG" }}
          error={errorOverride}
        />
      </form>
    </FormProvider>
);
}

describe("Field", () => {
  it("renders label, required marker, and input wired via htmlFor (plain mode)", () => {
    render(      <Field label="Host" htmlFor="host-input" required>
        <input id="host-input" type="text" />
      </Field>,
);
    const input = screen.getByLabelText(/Host/);
    expect(input).toBeInTheDocument();
    // The asterisk is decorative (aria-hidden), but it's present in the DOM.
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders an error message with role=alert when error prop is set", () => {
    render(      <Field label="Host" htmlFor="host-input" error="Required">
        <input id="host-input" type="text" />
      </Field>,
);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Required");
  });

  it("RHF mode: registers the input under the given name", () => {
    render(<RhfHarness defaultValues={{ name: "preset" }} />);
    const input = screen.getByLabelText(/Name/);
    // Defaults are applied async by RHF; we can at least confirm the input
    // is associated with name="name" via its registered attributes.
    expect(input).toHaveAttribute("name", "name");
    expect(input).toHaveAttribute("placeholder", "My PG");
  });

  it("RHF mode: surfaces an explicit error prop with aria-invalid + role=alert", () => {
    render(<RhfHarness errorOverride="Name required" />);
    const input = screen.getByLabelText(/Name/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Name required");
  });

  it("renders hint text when no error is present", () => {
    render(      <Field label="Host" htmlFor="host-input" hint="example: localhost">
        <input id="host-input" type="text" />
      </Field>,
);
    expect(screen.getByText("example: localhost")).toBeInTheDocument();
  });
});
