import { useEffect, useRef, useState } from "react";

/**
 * "Has the user interacted with this form yet?" — gate for required-field
 * validation errors so a freshly-opened editor doesn't scream
 * "Name is required / Body is required" before the user has typed anything.
 *
 * Strategy: snapshot the very first non-null form value the hook sees, then
 * flip `touched` once the form diverges from that snapshot. This avoids the
 * trap of "default values look like user content" — e.g. a function form
 * starts with `schema: "public"`, `language: "plpgsql"` etc., which would
 * fool a "any non-empty string?" heuristic into reporting touched on mount.
 *
 * Works the same for create-mode (snapshot = blank form) and edit-mode
 * (snapshot = loaded definition). The flag is sticky once true.
 *
 * The second argument is accepted for backwards-compatible call sites; the
 * actual logic only depends on `form`.
 */
export function useTouched(form: unknown, _initial?: unknown): boolean {
  const initialFormRef = useRef<unknown>(undefined);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    if (form === null || form === undefined) return;
    if (initialFormRef.current === undefined) {
      // First non-null value — snapshot it but don't flip yet.
      initialFormRef.current = form;
      return;
    }
    if (JSON.stringify(form) !== JSON.stringify(initialFormRef.current)) {
      setTouched(true);
    }
  }, [form, touched]);
  return touched;
}
