import { type ComponentPropsWithoutRef, type ReactNode, forwardRef, useId } from "react";
import { useFormContext } from "react-hook-form";

/**
 * Field — RHF-aware label + input + error message wrapper.
 *
 * Two usage modes:
 * 1. Plain mode: pass `label`, `error`, `htmlFor` directly. The `children`
 * slot accepts any control. This mode is used for non-RHF inputs (e.g.
 * a Radix <Select> trigger) or for tests that want to drive errors
 * explicitly.
 * 2. RHF mode: pass `name` and (optionally) input props. We resolve the
 * error from `useFormContext().formState.errors[name]` and call
 * `register(name, registerOptions)` to wire up the input.
 *
 * The component renders a single <label htmlFor> + control + an error
 * paragraph with `role="alert"` so screen readers announce validation
 * problems immediately.
 */

interface FieldBaseProps {
  /** Visible label text. Already translated by the caller. */
  label: string;
  /** Optional helper / hint text rendered below the input. */
  hint?: string;
  /** Additional className applied to the outer wrapper. */
  className?: string;
  /** Forces the field into an error state with this message (overrides RHF). */
  error?: string;
  /** Marks the field as required (renders the `*` glyph next to the label). */
  required?: boolean;
}

interface FieldChildrenProps extends FieldBaseProps {
  /** The input/control to render. Receives id automatically when in plain mode. */
  children: ReactNode;
  /** id used in label[htmlFor] + child input id. */
  htmlFor: string;
  name?: never;
  type?: never;
  inputProps?: never;
}

interface FieldRhfProps extends FieldBaseProps {
  /** RHF field name. Reads error from context, registers the input. */
  name: string;
  /** HTML input type. Defaults to "text". */
  type?: ComponentPropsWithoutRef<"input">["type"];
  /** Extra HTML input attributes (placeholder, autoComplete, …). */
  inputProps?: Omit<ComponentPropsWithoutRef<"input">, "name" | "type" | "id">;
  /** Coerce the raw RHF value to a number on change. */
  valueAsNumber?: boolean;
  children?: never;
  htmlFor?: never;
}

export type FieldProps = FieldChildrenProps | FieldRhfProps;

const inputClassName = "q-input";

export const Field = forwardRef<HTMLInputElement, FieldProps>((props, ref) => {
  const generatedId = useId();
  const isRhf = "name" in props && typeof props.name === "string";
  const id = isRhf ? `field-${(props as FieldRhfProps).name}-${generatedId}` : props.htmlFor;

  const errorId = `${id}-error`;
  const hintId = props.hint ? `${id}-hint` : undefined;

  // Always call the hook — RHF returns null outside a provider.
  const ctx = useFormContext();
  let errorMsg: string | undefined = props.error;
  let registerProps: Record<string, unknown> = {};
  if (isRhf && ctx) {
    const rhf = props as FieldRhfProps;
    const fieldError = ctx.formState.errors[rhf.name];
    if (!errorMsg && fieldError && typeof fieldError.message === "string") {
      errorMsg = fieldError.message;
    }
    registerProps = ctx.register(rhf.name, {
      valueAsNumber: rhf.valueAsNumber === true,
    });
  }

  return (    <div className={`q-field ${props.className ?? ""}`.trim()}>
      <label htmlFor={id}>
        {props.label}
        {props.required ? (          <span aria-hidden="true" className="req" style={{ marginLeft: 4 }}>
            *
          </span>
) : null}
      </label>
      {isRhf ? (        <input
          id={id}
          ref={ref}
          type={(props as FieldRhfProps).type ?? "text"}
          aria-invalid={errorMsg ? "true" : undefined}
          aria-describedby={
            [errorMsg ? errorId : null, hintId].filter(Boolean).join(" ") || undefined
          }
          className={inputClassName}
          {...(props as FieldRhfProps).inputProps}
          {...registerProps}
        />
) : (        (props as FieldChildrenProps).children
)}
      {props.hint && !errorMsg ? (        <p id={hintId} style={{ fontSize: 11, color: "var(--ink-4)", margin: 0 }}>
          {props.hint}
        </p>
) : null}
      {errorMsg ? (        <p id={errorId} role="alert" style={{ fontSize: 11, color: "var(--danger-q)", margin: 0 }}>
          {errorMsg}
        </p>
) : null}
    </div>
);
});

Field.displayName = "Field";
